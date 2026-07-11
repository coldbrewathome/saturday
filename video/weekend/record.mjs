#!/usr/bin/env node
// Render weekend.html to a silent MP4 per orientation. Scene data + VO-driven
// durations are injected (file:// can't fetch). The page-load lead-in is trimmed
// precisely via ffmpeg freezedetect. Writes raw/<orient>.mp4 (silent masters).
// Usage: node video/weekend/record.mjs  [vertical|landscape|both]

import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + path.join(here, "weekend.html");
const which = process.argv[2] || "both";

const scenes = JSON.parse(fs.readFileSync(path.join(here, "weekend-scenes.json"), "utf8"));
const durs = JSON.parse(fs.readFileSync(path.join(here, "durations.json"), "utf8"));
const totalSec = durs.reduce((a, b) => a + b, 0) / 1000;

const ORIENTS = {
  vertical: { w: 1080, h: 1920 },
  landscape: { w: 1920, h: 1080 },
};
const targets = which === "both" ? Object.keys(ORIENTS) : [which];

async function renderOne(orient) {
  const { w: W, h: H } = ORIENTS[orient];
  const rawDir = path.join(here, "raw", orient);
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });

  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text"] });
  const context = await browser.newContext({
    viewport: { width: W, height: H },
    deviceScaleFactor: 1,
    recordVideo: { dir: rawDir, size: { width: W, height: H } },
  });
  const page = await context.newPage();
  await page.addInitScript(({ s, d }) => {
    window.__manual = true; window.__scenes = s; window.__durs = d;
  }, { s: scenes, d: durs });
  await page.goto(pageUrl + "?orient=" + orient, { waitUntil: "networkidle" });
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(500);
  await page.evaluate(() => window.__start());
  await page.waitForFunction(() => window.__done === true, null, { timeout: 180000 });
  await page.waitForTimeout(400);

  const video = page.video();
  await context.close();
  await browser.close();
  const webm = await video.path();

  // Content is the tail of the recording. Seek from EOF (-sseof) so we don't
  // depend on webm's unreliable reported duration; pinned to the planned
  // totalSec to stay in sync with the VO track.
  const outMp4 = path.join(here, "raw", `${orient}.mp4`);
  execFileSync("ffmpeg", [
    "-y", "-sseof", `-${(totalSec + 0.4).toFixed(3)}`, "-i", webm, "-t", totalSec.toFixed(3),
    "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "19",
    "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", outMp4,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  console.log(`  ${orient}: content starts ${start}s → ${outMp4}`);
}

for (const o of targets) {
  console.log(`rendering ${o} (${ORIENTS[o].w}×${ORIENTS[o].h})…`);
  await renderOne(o);
}
console.log(`done — ${totalSec.toFixed(2)}s each`);
