#!/usr/bin/env node
// Generate famhop-intro.srt from the narration (scenes.mjs) timed to the
// rendered voiceover (vo-manifest.json). Each caption appears exactly when its
// line is spoken: start = scene.startAt, end = startAt + voDur. The two longest
// lines are split into two timed cues at a natural break for readability.

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { SCENES } from "./scenes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(HERE, "vo-manifest.json"), "utf8"));

const SPLIT_OVER = 88; // chars — lines longer than this become two timed cues

function ts(sec) {
  const ms = Math.round(sec * 1000);
  const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
  const m = String(Math.floor(ms / 60000) % 60).padStart(2, "0");
  const s = String(Math.floor(ms / 1000) % 60).padStart(2, "0");
  const f = String(ms % 1000).padStart(3, "0");
  return `${h}:${m}:${s},${f}`;
}

// Wrap one caption to <=2 balanced lines of ~42 chars.
function wrap(text, max = 42) {
  if (text.length <= max) return text;
  const words = text.split(" ");
  let best = words.length, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const a = words.slice(0, i).join(" ").length;
    const b = words.slice(i).join(" ").length;
    if (Math.max(a, b) <= max && Math.abs(a - b) < bestDiff) { bestDiff = Math.abs(a - b); best = i; }
  }
  return words.slice(0, best).join(" ") + "\n" + words.slice(best).join(" ");
}

// Split a long line near its middle at a comma/colon/em-dash.
function split(text) {
  const mid = text.length / 2;
  const marks = [...text.matchAll(/[,:—]/g)].map((m) => m.index);
  if (!marks.length) return [text];
  const at = marks.reduce((p, c) => (Math.abs(c - mid) < Math.abs(p - mid) ? c : p));
  return [text.slice(0, at + 1).trim(), text.slice(at + 1).trim()];
}

const cues = [];
SCENES.forEach((scene, i) => {
  const m = manifest.scenes[i];
  if (!m || m.id !== scene.id) throw new Error(`manifest/scenes mismatch at ${i}: ${m?.id} vs ${scene.id}`);
  const start = m.startAt;
  const dur = m.voDur;
  const parts = scene.vo.length > SPLIT_OVER ? split(scene.vo) : [scene.vo];
  const totalChars = parts.reduce((n, p) => n + p.length, 0);
  let t = start;
  for (const part of parts) {
    const slice = (part.length / totalChars) * dur;
    cues.push({ start: t, end: t + slice, text: wrap(part) });
    t += slice;
  }
});

const srt = cues.map((c, i) => `${i + 1}\n${ts(c.start)} --> ${ts(c.end)}\n${c.text}\n`).join("\n");
await writeFile(join(HERE, "famhop-intro.srt"), srt + "\n");
console.log(`Wrote famhop-intro.srt — ${cues.length} cues, ends ${ts(cues.at(-1).end)}`);
