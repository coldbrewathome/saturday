#!/usr/bin/env node
// Generate copy-paste YouTube metadata sheets per metro for manual Studio upload.
// Writes out/<metro>/youtube-metadata.md for each metro (default: the VO'd top 5).
//
//   node video/weekend/build-metadata.mjs                       # top 5
//   node video/weekend/build-metadata.mjs miami seattle         # specific metros

import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { curate } from "./curate.mjs";
import { METROS as METRO_CFG } from "./metros.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT = ["bay-area", "new-york-city", "los-angeles", "washington-dc", "chicago"];
const args = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const METROS = process.argv.includes("--all") ? Object.keys(METRO_CFG) : (args.length ? args : DEFAULT);

function sheet(plan) {
  const metro = plan.metroLabel, wk = plan.weekend.label;
  const { total, free } = plan.counts;
  const tag = metro.replace(/[^a-z]/gi, "").toLowerCase();
  const inMetro = /^bay area$/i.test(metro) ? `the ${metro}` : metro; // "in the Bay Area"
  // YouTube splits tags on commas, so strip the commas/periods in "Washington, D.C."
  const tagMetro = metro.replace(/[,.]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
  const lines = plan.events.map((e) => `• ${e.title} — ${e.venue}, ${e.city} (${e.whenLabel}${e.free ? ", free" : ""})`);
  const title = `${metro.replace(/,/g, "")} This Weekend: ${total} Things to Do With the Kids · ${wk}`;
  const description = `${total} family-friendly things to do in ${inMetro} this weekend (${wk})${free > 0 ? ` — ${free} of them free` : ""}. Here are a few we love:

${lines.join("\n")}

Find your whole weekend — parks, museums, festivals, and real family events near you, mapped into a plan you can share. Free at https://famhop.com

#thingstodo #${tag} #familyactivities #weekendplans #thingstodowithkids`;
  const tags = [`things to do in ${tagMetro}`, `${tagMetro} events`,
    `${tagMetro} with kids`, "family events this weekend", "things to do with kids",
    "weekend plans", "family activities", "kids activities", "FamHop"].join(", ");

  return `# ${metro} — YouTube upload sheet (${wk})

Files: out/${plan.metroId}/famhop-${plan.metroId}-weekend-landscape.mp4 (YouTube),
       out/${plan.metroId}/famhop-${plan.metroId}-weekend-vertical.mp4 (Shorts/Reels/TikTok)

## Title
\`\`\`
${title}
\`\`\`

## Description
\`\`\`
${description}
\`\`\`

## Tags
\`\`\`
${tags}
\`\`\`

## Settings
- Category: Travel & Events
- Audience: "No, it's not made for kids" (audience is parents)
- Language: English
- Playlist: "This Weekend in ${metro}" (create once, add weekly)
- Visibility: schedule for Friday AM of the target weekend (dated content)
- Thumbnail: the "${total}" hook frame, or the map with the pin
`;
}

for (const metro of METROS) {
  let plan;
  try { plan = await curate({ metro, weekend: "next", count: 7 }); } catch { console.log(`skip ${metro} (no data)`); continue; }
  const outDir = join(here, "out", metro);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "youtube-metadata.md"), sheet(plan));
  console.log(`wrote out/${metro}/youtube-metadata.md — "${plan.metroLabel} … ${plan.counts.total} things to do"`);
}
