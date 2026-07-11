#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright";
import { concepts, here, rawDir } from "./data.mjs";

const id = process.argv[2];
const concept = concepts().find((item) => item.id === id);
if (!concept) {
  console.error(`Usage: node render-one.mjs ${concepts().map((item) => item.id).join("|")}`);
  process.exit(1);
}

for (const scene of concept.scenes) {
  const imagePath = path.join(here, scene.image);
  if (!fs.existsSync(imagePath)) {
    throw new Error(`Missing screenshot asset: ${imagePath}. Run capture-app.mjs first.`);
  }
}

const W = 1080;
const H = 1920;
const rawVideoDir = path.join(rawDir, concept.id);
fs.rmSync(rawVideoDir, { recursive: true, force: true });
fs.mkdirSync(rawVideoDir, { recursive: true });

const browser = await chromium.launch({
  args: ["--force-color-profile=srgb", "--disable-lcd-text"],
});
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: rawVideoDir, size: { width: W, height: H } },
});
const page = await context.newPage();
await page.addInitScript((payload) => {
  window.__PROMO = payload;
  window.__manual = true;
}, concept);
await page.goto(`file://${path.join(here, "promo.html")}`, { waitUntil: "domcontentloaded" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.evaluate(() => window.__start());
await page.waitForFunction(() => window.__done === true, null, { timeout: 90000 });
await page.waitForTimeout(300);

const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();

let start = 0.4;
try {
  const fdOut = execFileSync("bash", [
    "-c",
    `ffmpeg -i "${webm}" -vf freezedetect=n=-60dB:d=0.25 -map 0:v -an -f null - 2>&1 | grep -o "freeze_end: [0-9.]*" | head -1`,
  ], { encoding: "utf8" }).trim();
  if (fdOut) start = parseFloat(fdOut.split(":")[1]) || start;
} catch {
  // The rendered page animates immediately after __start; a fixed trim is fine.
}

execFileSync("ffmpeg", [
  "-y",
  "-ss", String(start),
  "-i", webm,
  "-t", concept.totalSeconds.toFixed(3),
  "-r", "30",
  "-vf", "scale=1080:1920:flags=lanczos,format=yuv420p",
  "-c:v", "libx264",
  "-preset", "slow",
  "-crf", "18",
  "-pix_fmt", "yuv420p",
  "-movflags", "+faststart",
  "-an",
  concept.file,
], { stdio: ["ignore", "ignore", "inherit"] });

console.log(`wrote ${concept.file}`);

