// Enrich the next priority metro's venues with Google ratings, within the free
// tier. Picks the first metro in PRIORITY that still has un-enriched adult
// venues and runs one capped batch (≤ free monthly Place Details cap). Designed
// for the monthly GitHub Action (.github/workflows/enrich-ratings.yml) but also
// runnable locally: `node scripts/enrich-next.mjs`.
//
// Resumable: --merge skips venues already in the sidecar, so each monthly run
// continues where the last stopped without re-spending. The shared sidecar is
// keyed by spot id, so ratings apply to whichever app loads that spot.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Order Mosey cares about: live/curated metros first.
const PRIORITY = ["los-angeles", "new-york-city"];

// Stay safely under the 1,000/month Place Details (Enterprise) free cap.
const TOP = process.env.ENRICH_TOP || "950";

function spotsAdults(metro) {
  const p = `public/data/${metro}/spots-adults.json`;
  if (!existsSync(p)) return [];
  try {
    return JSON.parse(readFileSync(p, "utf8")).spots || [];
  } catch {
    return [];
  }
}

function sidecarEntries(metro) {
  for (const p of [
    `public/data/${metro}-enrichment.json`,
    `public/data/${metro}/enrichment.json`,
  ]) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf8")).entries || {};
      } catch {
        /* fall through */
      }
    }
  }
  return {};
}

let picked = null;
for (const metro of PRIORITY) {
  const spots = spotsAdults(metro);
  const entries = sidecarEntries(metro);
  const remaining = spots.filter((s) => s.id && !entries[s.id]).length;
  console.log(`${metro}: ${remaining} venues still need ratings`);
  if (remaining > 0 && !picked) picked = metro;
}

if (!picked) {
  console.log("All priority metros fully enriched — nothing to do this month.");
  process.exit(0);
}

console.log(`\nEnriching ${picked} (up to ${TOP} venues, free tier)…`);
execFileSync(
  "node",
  [
    "scripts/match-google-places-osm.mjs",
    `--metro=${picked}`,
    "--adults",
    "--include-all",
    "--merge",
    "--no-photos",
    `--top=${TOP}`,
  ],
  { stdio: "inherit" },
);
