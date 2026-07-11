// Renders youtube-intro.html to a silent MP4. Scene durations come from
// durations.json (written by build-vo.mjs) so the visuals match the narration.
// The page-load lead-in is trimmed precisely using ffmpeg freezedetect.
// Usage: node video/record.mjs
import { chromium } from "playwright";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageUrl = "file://" + path.join(here, "youtube-intro.html");
const rawDir = path.join(here, "raw");
fs.rmSync(rawDir, { recursive: true, force: true });
fs.mkdirSync(rawDir, { recursive: true });

const durs = JSON.parse(fs.readFileSync(path.join(here, "durations.json"), "utf8"));
const totalSec = durs.reduce((a, b) => a + b, 0) / 1000;
const W = 1920, H = 1080;

const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text"] });
const context = await browser.newContext({
  viewport: { width: W, height: H },
  deviceScaleFactor: 1,
  recordVideo: { dir: rawDir, size: { width: W, height: H } },
});
const page = await context.newPage();
await page.addInitScript((d) => { window.__manual = true; window.__durs = d; }, durs);
await page.goto(pageUrl, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(400);
await page.evaluate(() => window.__start());
await page.waitForFunction(() => window.__done === true, null, { timeout: 120000 });
await page.waitForTimeout(400);

const video = page.video();
await context.close();
await browser.close();
const webm = await video.path();

// Find where the static lead-in ends (first motion) and trim exactly there.
// freezedetect prints to stderr, so merge streams and grab the first freeze_end.
const fdOut = execFileSync("bash", ["-c",
  `ffmpeg -i "${webm}" -vf freezedetect=n=-60dB:d=0.3 -map 0:v -an -f null - 2>&1 | grep -o "freeze_end: [0-9.]*" | head -1`],
  { encoding: "utf8" }).trim();
const start = fdOut ? parseFloat(fdOut.split(":")[1]) : 1.0;
console.log("content starts at", start, "s; total", totalSec.toFixed(2), "s");

const outMp4 = path.join(here, "famhop-intro-youtube.mp4");
execFileSync("ffmpeg", [
  "-y", "-ss", String(start), "-i", webm, "-t", totalSec.toFixed(3),
  "-r", "30", "-c:v", "libx264", "-preset", "slow", "-crf", "19",
  "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", outMp4,
], { stdio: ["ignore", "ignore", "inherit"] });
console.log("wrote", outMp4);
