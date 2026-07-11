#!/usr/bin/env node
// ElevenLabs voiceover for the weekend video. One clip per scene (cached),
// measured, then assembled into a single timeline-aligned voiceover.wav. Writes
// durations.json (per-scene ms, for the recorder) and vo-manifest.json.
// Mirrors video/build-vo.mjs but reads weekend-scenes.json.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const voDir = path.join(here, "vo");
fs.mkdirSync(voDir, { recursive: true });

const LEAD = 0.35, TAIL = 0.6; // silence before / breathing room after each line
const API_KEY = process.env.ELEVENLABS_API_KEY;
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID;
const MODEL = "eleven_multilingual_v2";
if (!API_KEY || !VOICE_ID) throw new Error("ELEVENLABS_API_KEY / ELEVENLABS_VOICE_ID not set");

const { scenes } = JSON.parse(fs.readFileSync(path.join(here, "weekend-scenes.json"), "utf8"));

// Expand abbreviations so TTS speaks them naturally (not letter-by-letter).
const SAYS = [
  [/\bNWR\b/g, "National Wildlife Refuge"],
  [/\bSF\b/g, "San Francisco"],
  [/\bSJW\b/g, ""],
  [/&/g, "and"],
];
const spoken = (t) => SAYS.reduce((s, [re, to]) => s.replace(re, to), t).replace(/\s+/g, " ").trim();

const probeDur = (f) =>
  parseFloat(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration",
    "-of", "default=noprint_wrappers=1:nokey=1", f,
  ]).toString().trim());

async function tts(text, outPath) {
  const url = `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "xi-api-key": API_KEY, "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({
      text, model_id: MODEL,
      voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.25, use_speaker_boost: true },
    }),
  });
  if (!res.ok) throw new Error(`TTS ${res.status}: ${await res.text()}`);
  fs.writeFileSync(outPath, Buffer.from(await res.arrayBuffer()));
}

// 1) clip per scene (cache key = scene id + spoken text hash, so copy edits regen)
function hash(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return (h >>> 0).toString(36); }
const clips = [];
for (let i = 0; i < scenes.length; i++) {
  const s = scenes[i];
  const text = spoken(s.vo);
  const clip = path.join(voDir, `scene-${String(i).padStart(2, "0")}-${s.id}-${hash(text)}.mp3`);
  if (!fs.existsSync(clip) || fs.statSync(clip).size < 1000) {
    process.stdout.write(`tts ${i} ${s.id}… `);
    await tts(text, clip);
    console.log("ok");
  } else {
    console.log(`cached ${i} ${s.id}`);
  }
  const voDurS = probeDur(clip);
  const finalMs = Math.max(s.min, Math.round((LEAD + voDurS + TAIL) * 1000));
  clips.push({ i, id: s.id, clip, voDurS, finalMs });
}

// 2) durations for the recorder
const durations = clips.map((c) => c.finalMs);
fs.writeFileSync(path.join(here, "durations.json"), JSON.stringify(durations));

// 3) assemble the full voiceover: each clip delayed to its scene start + LEAD
const totalMs = durations.reduce((a, b) => a + b, 0);
let acc = 0;
const offsets = clips.map((c) => { const off = acc + Math.round(LEAD * 1000); acc += c.finalMs; return off; });
const inputs = clips.flatMap((c) => ["-i", c.clip]);
const parts = clips.map((c, n) => `[${n}:a]adelay=${offsets[n]}|${offsets[n]}[a${n}]`);
const mixIns = clips.map((_, n) => `[a${n}]`).join("");
const filter =
  parts.join(";") +
  `;${mixIns}amix=inputs=${clips.length}:normalize=0:duration=longest[mix];` +
  `[mix]apad=whole_dur=${(totalMs / 1000).toFixed(3)}[out]`;
execFileSync("ffmpeg", [
  "-y", ...inputs, "-filter_complex", filter,
  "-map", "[out]", "-t", (totalMs / 1000).toFixed(3),
  "-c:a", "pcm_s16le", path.join(here, "voiceover.wav"),
], { stdio: ["ignore", "ignore", "inherit"] });

fs.writeFileSync(path.join(here, "vo-manifest.json"), JSON.stringify({
  totalSeconds: +(totalMs / 1000).toFixed(2),
  scenes: clips.map((c, n) => ({ id: c.id, voDur: +c.voDurS.toFixed(2), sceneDur: +(c.finalMs / 1000).toFixed(2), startAt: +(offsets[n] / 1000).toFixed(2) })),
}, null, 2));

console.log(`\nTotal video length: ${(totalMs / 1000).toFixed(2)}s`);
