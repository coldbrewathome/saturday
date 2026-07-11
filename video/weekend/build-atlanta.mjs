#!/usr/bin/env node
// Reference build for Atlanta: real OSM maps per event, optional event-page
// screenshots, opening + ending scenes, both orientations, music only (no VO).
// This is the "polished one" to iterate on before rolling features into build-all.
//
//   node video/weekend/build-atlanta.mjs            # maps + screenshots
//   node video/weekend/build-atlanta.mjs --no-shots # maps only (skip screenshots)

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { curate } from "./curate.mjs";
import { buildScenes } from "./build-scenes.mjs";
import { enrichEvents } from "./enrich.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "..");
const MUSIC = path.join(here, "..", "music.mp3");
const pageUrl = "file://" + path.join(here, "weekend.html");
const METRO = "atlanta";
const NO_SHOTS = process.argv.includes("--no-shots");
const ORIENTS = { vertical: { w: 1080, h: 1920 }, landscape: { w: 1920, h: 1080 } };

async function renderSilent(scenes, durs, orient) {
  const { w: W, h: H } = ORIENTS[orient];
  const rawDir = path.join(here, "raw", `${METRO}-${orient}`);
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text"] });
  const context = await browser.newContext({
    viewport: { width: W, height: H }, deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  await page.addInitScript(({ s, d }) => { window.__manual = true; window.__scenes = s; window.__durs = d; }, { s: scenes, d: durs });
  await page.goto(pageUrl + "?orient=" + orient, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__start());
  await page.waitForFunction(() => window.__done === true, null, { timeout: 180000 });
  const contentMs = await page.evaluate(() => window.__contentMs || 0);
  await page.waitForTimeout(400);
  const video = page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();
  const contentSec = contentMs > 0 ? contentMs / 1000 : durs.reduce((a, b) => a + b, 0) / 1000;
  const silent = path.join(rawDir, "silent.mp4");
  execFileSync("ffmpeg", ["-y", "-sseof", `-${(contentSec + 0.4).toFixed(3)}`, "-i", webm, "-t", contentSec.toFixed(3),
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", silent], { stdio: "ignore" });
  return { silent, contentSec };
}

function muxMusic(silent, totalSec, out) {
  const FO = (totalSec - 2).toFixed(3);
  const filter = `[1:a]volume=0.6,afade=t=in:st=0:d=1.2,afade=t=out:st=${FO}:d=2,atrim=0:${totalSec.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[ao]`;
  execFileSync("ffmpeg", ["-y", "-i", silent, "-i", MUSIC, "-filter_complex", filter,
    "-map", "0:v", "-map", "[ao]", "-t", totalSec.toFixed(3),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", out], { stdio: "ignore" });
}

// 1) curate + enrich
console.log("Curating Atlanta…");
const plan = await curate({ metro: METRO, weekend: "next", count: 7 });
console.log(`  ${plan.counts.total} events; enriching ${plan.events.length} with maps + images…`);
const enr = await enrichEvents(plan.events, { shots: !NO_SHOTS });
console.log(`  ${enr.maps} maps, ${enr.shots} images`);

// 2) scenes + attach enrichment onto event scenes (by index)
const scenes = buildScenes(plan);
let ei = 0;
for (const s of scenes.scenes) {
  if (s.type === "event") { const e = plan.events[ei++]; s.mapImage = e.mapImage; s.shot = e.shot; }
}
const durs = scenes.scenes.map((s) => s.min);

// 3) render + mux both orientations
const outDir = path.join(here, "out", METRO);
fs.mkdirSync(outDir, { recursive: true });
for (const orient of Object.keys(ORIENTS)) {
  console.log(`rendering ${orient}…`);
  const { silent, contentSec } = await renderSilent(scenes, durs, orient);
  const out = path.join(outDir, `famhop-${METRO}-weekend-${orient}.mp4`);
  muxMusic(silent, contentSec, out);
  console.log(`  → ${path.relative(ROOT, out)}`);
}
console.log("\n✅ Atlanta done (real maps, open+ending, music only).");
