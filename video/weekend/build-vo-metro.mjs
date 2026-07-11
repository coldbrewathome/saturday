#!/usr/bin/env node
// Full-quality build for a few metros: VO + real maps + og:images + open/ending.
// Sequential (VO files are per-metro; ElevenLabs is rate-limited anyway).
// Overwrites out/<metro>/famhop-<metro>-weekend-<orient>.mp4 with VO versions.
//
//   node video/weekend/build-vo-metro.mjs                         # default top 5
//   node video/weekend/build-vo-metro.mjs miami seattle           # specific metros
//
// Needs ELEVENLABS_API_KEY + ELEVENLABS_VOICE_ID (same as the intro).

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

const DEFAULT = ["bay-area", "new-york-city", "los-angeles", "washington-dc", "chicago"];
const metros = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const METROS = metros.length ? metros : DEFAULT;
const ORIENTS = { vertical: { w: 1080, h: 1920 }, landscape: { w: 1920, h: 1080 } };

const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const MODEL = "eleven_multilingual_v2";
if (!API_KEY || !VOICE_ID) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set");
const LEAD = 0.35, TAIL = 0.6;

// Speak abbreviations naturally.
const SAYS = [[/\bNWR\b/g, "National Wildlife Refuge"], [/\bSF\b/g, "San Francisco"], [/\bSJW\b/g, ""], [/&/g, "and"]];
const spoken = (t) => SAYS.reduce((s, [re, to]) => s.replace(re, to), t).replace(/\s+/g, " ").trim();
const hash = (s) => { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); };
const probeDur = (f) => parseFloat(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", f]).toString().trim());

async function tts(text, outPath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: MODEL, voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true } }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

async function generateVO(scenes, metro) {
  const voDir = path.join(here, "out", metro, "vo");
  fs.mkdirSync(voDir, { recursive: true });
  const clips = [];
  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i];
    const text = spoken(s.vo);
    const clip = path.join(voDir, `scene-${String(i).padStart(2, "0")}-${s.id}-${hash(text)}.mp3`);
    if (!fs.existsSync(clip) || fs.statSync(clip).size < 1000) { process.stdout.write(`    tts ${s.id}… `); await tts(text, clip); console.log("ok"); }
    const voDurS = probeDur(clip);
    clips.push({ clip, finalMs: Math.max(s.min, Math.round((LEAD + voDurS + TAIL) * 1000)) });
  }
  const durations = clips.map((c) => c.finalMs);
  const totalMs = durations.reduce((a, b) => a + b, 0);
  let acc = 0;
  const offsets = clips.map((c) => { const off = acc + Math.round(LEAD * 1000); acc += c.finalMs; return off; });
  const inputs = clips.flatMap((c) => ["-i", c.clip]);
  const parts = clips.map((c, n) => `[${n}:a]adelay=${offsets[n]}|${offsets[n]}[a${n}]`);
  const mixIns = clips.map((_, n) => `[a${n}]`).join("");
  const filter = parts.join(";") + `;${mixIns}amix=inputs=${clips.length}:normalize=0:duration=longest[mix];[mix]apad=whole_dur=${(totalMs / 1000).toFixed(3)}[out]`;
  const voPath = path.join(here, "out", metro, "voiceover.wav");
  execFileSync("ffmpeg", ["-y", ...inputs, "-filter_complex", filter, "-map", "[out]", "-t", (totalMs / 1000).toFixed(3), "-c:a", "pcm_s16le", voPath], { stdio: "ignore" });
  return { durations, voPath, totalSec: totalMs / 1000 };
}

async function renderSilent(scenes, durs, orient, metro) {
  const { w: W, h: H } = ORIENTS[orient];
  const totalSec = durs.reduce((a, b) => a + b, 0) / 1000;
  const rawDir = path.join(here, "raw", `${metro}-${orient}`);
  fs.rmSync(rawDir, { recursive: true, force: true });
  fs.mkdirSync(rawDir, { recursive: true });
  const browser = await chromium.launch({ args: ["--force-color-profile=srgb", "--disable-lcd-text"] });
  const context = await browser.newContext({ viewport: { width: W, height: H }, deviceScaleFactor: 1, recordVideo: { dir: rawDir, size: { width: W, height: H } } });
  const page = await context.newPage();
  await page.addInitScript(({ s, d }) => { window.__manual = true; window.__scenes = s; window.__durs = d; }, { s: scenes, d: durs });
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
  const silent = path.join(rawDir, "silent.mp4");
  execFileSync("ffmpeg", ["-y", "-sseof", `-${(totalSec + 0.4).toFixed(3)}`, "-i", webm, "-t", totalSec.toFixed(3),
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", silent], { stdio: "ignore" });
  return silent;
}

function muxVO(silent, vo, totalSec, out) {
  const FO = (totalSec - 2).toFixed(3);
  const filter = [
    "[2:a]volume=1.5,asplit=2[v1][v2]",
    `[1:a]volume=0.5,afade=t=in:st=0:d=1.2,afade=t=out:st=${FO}:d=2[m]`,
    "[m][v1]sidechaincompress=threshold=0.04:ratio=8:attack=80:release=400[mc]",
    "[mc][v2]amix=inputs=2:duration=first:normalize=0[mix]",
    "[mix]loudnorm=I=-15:TP=-1.5:LRA=11[ao]",
  ].join(";");
  execFileSync("ffmpeg", ["-y", "-i", silent, "-i", MUSIC, "-i", vo, "-filter_complex", filter,
    "-map", "0:v", "-map", "[ao]", "-t", totalSec.toFixed(3), "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out], { stdio: "ignore" });
}

for (const metro of METROS) {
  console.log(`\n=== ${metro} ===`);
  const plan = await curate({ metro, weekend: "next", count: 7 });
  const enr = await enrichEvents(plan.events, { shots: true });
  console.log(`  ${plan.counts.total} events · ${enr.maps} maps · ${enr.shots} images`);
  const scenes = buildScenes(plan);
  let ei = 0;
  for (const s of scenes.scenes) { if (s.type === "event") { const e = plan.events[ei++]; s.mapImage = e.mapImage; s.shot = e.shot; } }
  console.log("  generating voiceover…");
  const { durations, voPath, totalSec } = await generateVO(scenes.scenes, metro);
  for (const orient of Object.keys(ORIENTS)) {
    const silent = await renderSilent(scenes, durations, orient, metro);
    const out = path.join(here, "out", metro, `famhop-${metro}-weekend-${orient}.mp4`);
    muxVO(silent, voPath, totalSec, out);
    console.log(`  → ${path.relative(ROOT, out)} (${totalSec.toFixed(1)}s)`);
  }
}
console.log(`\n✅ VO build done for: ${METROS.join(", ")}`);
