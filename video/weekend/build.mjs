#!/usr/bin/env node
// One command to produce the weekend video end to end:
//   curate → build-scenes → build-vo → record (both orientations) → mux.
// Music is auto-ducked under the voice (sidechaincompress) then loudness
// normalized, matching the intro. Outputs:
//   famhop-bayarea-weekend-vertical.mp4   (1080×1920, Shorts/Reels/TikTok)
//   famhop-bayarea-weekend-landscape.mp4  (1920×1080, YouTube)
//
//   node video/weekend/build.mjs                 # this weekend
//   node video/weekend/build.mjs --weekend next  # forwarded to curate.mjs
//   node video/weekend/build.mjs --skip-curate   # reuse current plan/scenes

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC = path.join(here, "..", "music.mp3");
const VO = path.join(here, "voiceover.wav");

const args = process.argv.slice(2);
const skipCurate = args.includes("--skip-curate");
const curateArgs = args.filter((a) => a !== "--skip-curate");
const run = (script, a = []) => execFileSync("node", [path.join(here, script), ...a], { stdio: "inherit" });

if (!skipCurate) { run("curate.mjs", curateArgs); run("build-scenes.mjs"); }
run("build-vo.mjs");
run("record.mjs", ["both"]);

const T = JSON.parse(fs.readFileSync(path.join(here, "vo-manifest.json"), "utf8")).totalSeconds;
const FO = (T - 2).toFixed(3);
const filter = [
  "[2:a]volume=1.5,asplit=2[v1][v2]",
  `[1:a]volume=0.5,afade=t=in:st=0:d=1.2,afade=t=out:st=${FO}:d=2[m]`,
  "[m][v1]sidechaincompress=threshold=0.04:ratio=8:attack=80:release=400[mc]",
  "[mc][v2]amix=inputs=2:duration=first:normalize=0[mix]",
  "[mix]loudnorm=I=-15:TP=-1.5:LRA=11[ao]",
].join(";");

for (const orient of ["vertical", "landscape"]) {
  const silent = path.join(here, "raw", `${orient}.mp4`);
  const out = path.join(here, `famhop-bayarea-weekend-${orient}.mp4`);
  console.log(`muxing ${orient}…`);
  execFileSync("ffmpeg", [
    "-y", "-i", silent, "-i", MUSIC, "-i", VO,
    "-filter_complex", filter,
    "-map", "0:v", "-map", "[ao]", "-t", T.toFixed(3),
    "-c:v", "copy", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", out,
  ], { stdio: ["ignore", "ignore", "inherit"] });
  console.log("  →", out);
}
console.log(`\n✅ Done — ${T.toFixed(1)}s, both orientations.`);
