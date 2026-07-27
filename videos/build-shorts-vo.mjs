#!/usr/bin/env node
// Generate the three shorts' narration with ElevenLabs.
//
// Same voice as videos/famhop-promo ("Brian" — middle-aged American male,
// conversational) so the channel sounds like one channel. Clips are cached:
// delete assets/voice/NN.mp3 in a project to regenerate just that line.
//
//   ELEVENLABS_API_KEY=... node videos/build-shorts-vo.mjs

import { writeFile, mkdir, access } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID || "Gubgw9l4dtIoQA9YZHgx";
const API_KEY = process.env.ELEVENLABS_API_KEY;
if (!API_KEY) {
  console.error("ELEVENLABS_API_KEY is not set");
  process.exit(1);
}

// `at` is the timeline position the clip is mounted at; `budget` is the window
// it has to fit inside. Lines were written to the window — never stretch the
// window to a line (that would shrink the frames it belongs to).
const PROJECTS = {
  "famhop-short-bay": [
    { at: 0.10, budget: 2.9, text: "No plan for Saturday? Six free ones." },
    { at: 3.20, budget: 3.4, text: "Every one is real, this weekend, and free to walk into." },
    { at: 10.40, budget: 3.4, text: "Festivals, a science center, a free park concert." },
    { at: 17.60, budget: 3.4, text: "Screenshot the ones you want. There are hundreds more." },
    { at: 24.90, budget: 5.0, text: "Eight hundred ninety five Bay Area family events next week. Famhop dot com." },
  ],
  "famhop-short-count": [
    { at: 0.20, budget: 4.6, text: "Next week: five thousand, one hundred and sixty three things to do with the kids." },
    { at: 5.20, budget: 3.2, text: "More than two thousand of them are free." },
    { at: 8.90, budget: 9.8, text: "Sixteen metros, counted city by city. The Bay Area is the biggest. Austin is the smallest, at twenty seven. We are not going to pretend otherwise." },
    { at: 19.20, budget: 3.3, text: "All of it straight from the venues themselves." },
    { at: 22.90, budget: 5.0, text: "Pick your city. Plan the weekend. Famhop dot com." },
  ],
  "famhop-short-nyc": [
    { at: 0.10, budget: 2.9, text: "A whole Saturday in New York. Cost: zero." },
    { at: 3.20, budget: 3.4, text: "Start at the greenmarket in Prospect Park." },
    { at: 6.80, budget: 3.4, text: "Stay for the nature walk and the pop up Audubon." },
    { at: 13.90, budget: 3.4, text: "Cross to Washington Square for open art studio." },
    { at: 17.50, budget: 3.4, text: "Story hour on the Hudson at three." },
    { at: 21.10, budget: 3.4, text: "Then a movie under the stars on Randall's Island." },
    { at: 24.90, budget: 5.0, text: "Running total: still zero. Famhop dot com, New York City." },
  ],
};

const exists = async (p) => access(p).then(() => true, () => false);

for (const [project, lines] of Object.entries(PROJECTS)) {
  const dir = join(HERE, project, "assets", "voice");
  await mkdir(dir, { recursive: true });

  for (const [i, line] of lines.entries()) {
    const name = String(i + 1).padStart(2, "0") + ".mp3";
    const out = join(dir, name);
    if (await exists(out)) {
      console.log(`${project}/${name}  cached`);
      continue;
    }
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`,
      {
        method: "POST",
        headers: { "xi-api-key": API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({
          text: line.text,
          model_id: "eleven_multilingual_v2",
          voice_settings: { stability: 0.45, similarity_boost: 0.8, style: 0.15, use_speaker_boost: true },
        }),
      }
    );
    if (!res.ok) {
      console.error(`${project}/${name} failed ${res.status}: ${await res.text()}`);
      process.exit(1);
    }
    await writeFile(out, Buffer.from(await res.arrayBuffer()));
    console.log(`${project}/${name}  ${line.text}`);
  }
}
