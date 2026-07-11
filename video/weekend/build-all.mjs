#!/usr/bin/env node
// Build weekend videos for ALL metros that have data, in parallel, with NO
// voiceover (to save ElevenLabs spend) — just a music bed. For preview.
// Each metro is themed (accent, landmark emojis, nickname) via metros.mjs.
//
//   node video/weekend/build-all.mjs                       # next weekend, both orientations
//   node video/weekend/build-all.mjs --orient vertical     # one orientation
//   node video/weekend/build-all.mjs --weekend this --concurrency 2
//
// Output: out/<metro>/famhop-<metro>-weekend-<orient>.mp4  (+ lineup.txt)

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { curate } from "./curate.mjs";
import { buildScenes } from "./build-scenes.mjs";
import { enrichEvents } from "./enrich.mjs";
import { METROS } from "./metros.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, "..", "..");
const MUSIC = path.join(here, "..", "music.mp3");
const pageUrl = "file://" + path.join(here, "weekend.html");

const arg = (name, def = null) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def; };
const WEEKEND = arg("weekend", "next");
const ORIENT = arg("orient", "both");
const ONLY = arg("only"); // comma-separated metro ids, for smoke-testing
const NO_SHOTS = process.argv.includes("--no-shots"); // skip og:image fetch
const NO_MAPS = process.argv.includes("--no-maps");   // use stylized map instead
const CONCURRENCY = Number(arg("concurrency", "3"));
const MIN_EVENTS = 4;
const ORIENTS = { vertical: { w: 1080, h: 1920 }, landscape: { w: 1920, h: 1080 } };
const wantOrients = ORIENT === "both" ? Object.keys(ORIENTS) : [ORIENT];

async function poolMap(items, cap, worker) {
  const results = []; let i = 0;
  async function next() {
    const idx = i++;
    if (idx >= items.length) return;
    results[idx] = await worker(items[idx], idx).catch((e) => ({ error: e.message, item: items[idx] }));
    return next();
  }
  await Promise.all(Array.from({ length: Math.min(cap, items.length) }, next));
  return results;
}

async function renderSilent(job) {
  const { metro, orient, scenes, durs } = job;
  const { w: W, h: H } = ORIENTS[orient];
  const rawDir = path.join(here, "raw", `${metro}-${orient}`);
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const totalSec = durs.reduce((a, b) => a + b, 0) / 1000;

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
  // page measured its own content duration → deterministic trim (load-proof,
  // unlike freezedetect which mis-fired under parallel render load).
  const contentMs = await page.evaluate(() => window.__contentMs || 0);
  await page.waitForTimeout(400); // post-roll tail
  const video = page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();

  // Content is the tail of the recording: the last contentSec before the 0.4s
  // post-roll. Seek from EOF (-sseof) so we don't depend on webm's unreliable
  // reported duration — robust under parallel-render timing drift.
  const contentSec = contentMs > 0 ? contentMs / 1000 : totalSec;
  const silent = path.join(rawDir, "silent.mp4");
  execFileSync("ffmpeg", ["-y", "-sseof", `-${(contentSec + 0.4).toFixed(3)}`, "-i", webm, "-t", contentSec.toFixed(3),
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", silent], { stdio: "ignore" });
  return { silent, totalSec: contentSec };
}

function muxMusic(silent, totalSec, outPath) {
  const FO = (totalSec - 2).toFixed(3);
  const filter = `[1:a]volume=0.6,afade=t=in:st=0:d=1.2,afade=t=out:st=${FO}:d=2,atrim=0:${totalSec.toFixed(3)},loudnorm=I=-16:TP=-1.5:LRA=11[ao]`;
  execFileSync("ffmpeg", ["-y", "-i", silent, "-i", MUSIC, "-filter_complex", filter,
    "-map", "0:v", "-map", "[ao]", "-t", totalSec.toFixed(3),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", "-movflags", "+faststart", outPath], { stdio: "ignore" });
}

// 1) curate + scene-build every available metro (fast, no rendering)
console.log(`Curating ${WEEKEND} weekend for all metros…`);
const jobs = [];
const onlySet = ONLY ? new Set(ONLY.split(",")) : null;
for (const metro of Object.keys(METROS)) {
  if (onlySet && !onlySet.has(metro)) continue;
  if (!fs.existsSync(path.join(ROOT, "public", "data", metro, "events.json"))) continue;
  let plan;
  try { plan = await curate({ metro, weekend: WEEKEND, count: 7 }); } catch { continue; }
  if (plan.events.length < MIN_EVENTS) { console.log(`  skip ${metro} (${plan.events.length} events)`); continue; }
  const enr = await enrichEvents(plan.events, { maps: !NO_MAPS, shots: !NO_SHOTS });
  console.log(`  ${metro}: ${enr.maps} maps, ${enr.shots} images`);
  const scenes = buildScenes(plan);
  let ei = 0;
  for (const s of scenes.scenes) { if (s.type === "event") { const e = plan.events[ei++]; s.mapImage = e.mapImage; s.shot = e.shot; } }
  const durs = scenes.scenes.map((s) => s.min);
  const outDir = path.join(here, "out", metro);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "lineup.txt"),
    `${plan.metroLabel} · ${plan.weekend.label} — ${plan.counts.total} events (${plan.counts.free} free)\n\n` +
    plan.events.map((e, i) => `${i + 1}. ${e.emoji} ${e.title} — ${e.venue}, ${e.city} · ${e.whenLabel}${e.free ? " · FREE" : ""}`).join("\n") + "\n");
  for (const orient of wantOrients) jobs.push({ metro, orient, scenes, durs, outDir, label: plan.metroLabel });
}
console.log(`${jobs.length} renders across ${new Set(jobs.map((j) => j.metro)).size} metros (concurrency ${CONCURRENCY}, no VO)\n`);

// 2) render + mux, in parallel
let done = 0;
const results = await poolMap(jobs, CONCURRENCY, async (job) => {
  const { silent, totalSec } = await renderSilent(job);
  const out = path.join(job.outDir, `famhop-${job.metro}-weekend-${job.orient}.mp4`);
  muxMusic(silent, totalSec, out);
  console.log(`  [${++done}/${jobs.length}] ${job.label} ${job.orient} → ${path.relative(ROOT, out)}`);
  return out;
});

const failed = results.filter((r) => r && r.error);
console.log(`\n✅ Done — ${results.length - failed.length}/${jobs.length} rendered (no VO, music only).`);
if (failed.length) for (const f of failed) console.log(`  ✗ ${f.item.metro} ${f.item.orient}: ${f.error}`);
console.log(`Outputs in video/weekend/out/<metro>/`);
