#!/usr/bin/env node
/**
 * One-time matcher: enrich an OSM spot dataset with Google Places data.
 *
 * The OSM dataset is regenerated daily by the ingest workflow, so we cannot
 * write back to it directly. This script writes a sidecar keyed by spot id.
 * App.tsx merges the sidecar into the loaded dataset by id at runtime.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=AIza... node scripts/match-google-places-osm.mjs
 *   GOOGLE_PLACES_API_KEY=AIza... node scripts/match-google-places-osm.mjs --metro=los-angeles
 *   GOOGLE_PLACES_API_KEY=AIza... node scripts/match-google-places-osm.mjs --all
 *
 * Optional flags:
 *   --metro=SLUG       Run for a specific metro (default: bay-area).
 *   --all              Run for every metro in metros.json.
 *   --top=N            Only process the top N spots by friendScore (default 300).
 *   --include-all      Process every spot, not just ones using the category
 *                      fallback image (still capped by --top).
 *   --dry-run          Don't write the sidecar; emit the report only.
 *   --no-photos        Skip the Place Photos call (saves ~$0.007/entry).
 *   --merge            Merge into an existing sidecar instead of overwriting,
 *                      so a partial / interrupted run can be resumed cheaply.
 *
 * Cost estimate: ~$0.041 per entry with photos, ~$0.034 without.
 *   --top=300 with photos ≈ $12. --top=300 --no-photos ≈ $10.
 *   --top=500 with photos ≈ $21.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  CATEGORY_INCLUDED_TYPE,
  buildEnrichment,
  buildQuery,
  createPlacesClient,
} from "./lib/places-match.mjs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";
import {
  createUsageMeter,
  printUsage,
  FREE_CAPS,
} from "./lib/places-usage.mjs";

// Load GOOGLE_PLACES_API_KEY from .env.local if not already in the environment
// (gitignored; keeps the key out of the shell history / git).
if (!process.env.GOOGLE_PLACES_API_KEY && existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^GOOGLE_PLACES_API_KEY=(.*)$/);
    if (m) process.env.GOOGLE_PLACES_API_KEY = m[1].trim().replace(/^["']|["']$/g, "");
  }
}

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
if (!apiKey) {
  console.error("Missing GOOGLE_PLACES_API_KEY env var.");
  process.exit(1);
}

// Free-tier spend guard. The meter records every billable call to
// data/places-usage.json and refuses to exceed the monthly free caps.
const meter = createUsageMeter();

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipPhotos = args.includes("--no-photos");
const includeAll = args.includes("--include-all");
const merge = args.includes("--merge");
const topArg = args.find((a) => a.startsWith("--top="));
const top = topArg ? Number(topArg.split("=")[1]) : 300;

const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(args, metroConfig);
const metros = selection.all
  ? metroConfig.metros
  : [selection.metro || metroConfig.defaultMetro];

for (const metro of metros) {
  const inputPath = legacyMetroDataFile(metro, "spots") || metroDataFile(metro, "spots");
  const sidecarPath = legacyMetroDataFile(metro, "enrichment") || metroDataFile(metro, "enrichment");
  const reportPath = sidecarPath.replace(/\.json$/, "-report.json");
  console.log(`[${metro.id}] enriching ${inputPath} → ${sidecarPath}`);
  await runEnrichment(inputPath, sidecarPath, reportPath);
}

async function runEnrichment(inputPath, sidecarPath, reportPath) {

  if (!existsSync(inputPath)) {
    console.log(`  Skipped — ${inputPath} not found.`);
    return;
  }
  const file = JSON.parse(readFileSync(inputPath, "utf8"));
const spots = Array.isArray(file.spots) ? file.spots : [];

const existingSidecar =
  merge && existsSync(sidecarPath)
    ? JSON.parse(readFileSync(sidecarPath, "utf8"))
    : { schemaVersion: 1, entries: {} };
const sidecar = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  entries: { ...(existingSidecar.entries ?? {}) },
};

// Selection: prefer spots that are visibly using the generic category fallback
// image, since they're the ones whose discovery quality benefits most. Sort by
// friendScore so we spend the budget on spots most likely to surface in plans.
const candidates = spots
  .filter((spot) => {
    if (includeAll) return true;
    return !spot.imageSource || spot.imageSource === "Category fallback";
  })
  .filter((spot) => !merge || !sidecar.entries[spot.id])
  .sort((left, right) => (right.friendScore ?? 0) - (left.friendScore ?? 0));

// Cap this run to the remaining monthly free budget so we never spend. Worst
// case a spot costs up to 3 Text Search + 1 Place Details; Place Details
// (1,000/mo) is the binding SKU.
const remDetails = meter.remaining("placeDetails");
const remSearch = meter.remaining("textSearch");
const safeBatch = Math.max(
  0,
  Math.min(Math.max(0, top), remDetails, Math.floor(remSearch / 3)),
);
if (safeBatch < top) {
  console.log(
    `  Capping to ${safeBatch} spots to stay free ` +
      `(${remDetails}/${FREE_CAPS.placeDetails} Place Details + ${remSearch}/${FREE_CAPS.textSearch} Text Search left this month).`,
  );
}
const toProcess = candidates.slice(0, safeBatch);
if (toProcess.length === 0) {
  console.log("  Free-tier budget exhausted for this month — nothing to do.");
  printUsage(meter.month);
  return;
}

console.log(
  `Matching ${toProcess.length} of ${candidates.length} candidate spots ` +
    `(dataset: ${spots.length}, top=${top}, includeAll=${includeAll}, merge=${merge}).`,
);

const client = createPlacesClient(apiKey, meter);

const report = {
  generatedAt: new Date().toISOString(),
  total: 0,
  matched: 0,
  unmatched: 0,
  closed: 0,
  errors: 0,
  entries: [],
};

for (let i = 0; i < toProcess.length; i += 1) {
  const spot = toProcess[i];
  const query = buildQuery(spot, true);
  const queryNoHint = buildQuery(spot, false);
  const includedType = CATEGORY_INCLUDED_TYPE[spot.category];
  report.total += 1;
  try {
    const match = await client.searchText(
      spot,
      query,
      queryNoHint,
      { lat: spot.lat, lon: spot.lon },
      includedType,
    );
    if (!match || !match.id) {
      report.unmatched += 1;
      // Mark as checked so --merge skips it next run (no re-spending search).
      sidecar.entries[spot.id] = { googlePlaceId: null, noMatch: true };
      report.entries.push({ id: spot.id, query, status: "no-match" });
      console.log(`[${i + 1}/${toProcess.length}] ✗ no match  ${spot.id}`);
      continue;
    }
    const details = await client.placeDetails(match.id);
    const status =
      details.businessStatus || match.businessStatus || "OPERATIONAL";
    if (status === "CLOSED_PERMANENTLY") {
      report.closed += 1;
      sidecar.entries[spot.id] = {
        googlePlaceId: match.id,
        businessStatus: status,
        verified: false,
      };
      report.entries.push({
        id: spot.id,
        query,
        status: "closed",
        placeId: match.id,
      });
      console.log(`[${i + 1}/${toProcess.length}] ✗ CLOSED   ${spot.id}`);
      continue;
    }
    let photo = null;
    if (!skipPhotos) {
      try {
        photo = await client.fetchPlacePhoto(details);
      } catch (photoError) {
        console.error(
          `[${i + 1}/${toProcess.length}]   photo skipped: ${photoError.message}`,
        );
      }
    }
    sidecar.entries[spot.id] = buildEnrichment({ spot, match, details, photo });
    report.matched += 1;
    report.entries.push({
      id: spot.id,
      query,
      status: "matched",
      placeId: match.id,
      operational: status === "OPERATIONAL",
    });
    console.log(
      `[${i + 1}/${toProcess.length}] ✓ ${spot.id}  →  ${match.displayName?.text || match.id}`,
    );
  } catch (error) {
    if (error.isBudget) {
      console.warn(`  ${error.message} Stopping run and saving progress.`);
      break;
    }
    report.errors += 1;
    report.entries.push({
      id: spot.id,
      query,
      status: "error",
      error: error.message,
    });
    console.error(
      `[${i + 1}/${toProcess.length}] ! error    ${spot.id}: ${error.message}`,
    );
  }
}

if (!dryRun) {
  writeFileSync(sidecarPath, JSON.stringify(sidecar, null, 2) + "\n");
  console.log(
    `\nWrote ${Object.keys(sidecar.entries).length} sidecar entries to ${sidecarPath}`,
  );
} else {
  console.log("\n(dry run — sidecar not modified)");
}

  writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
  console.log(`Report written to ${reportPath}`);
  printUsage(meter.month);
  console.log(
    `Summary: ${report.matched} matched, ${report.unmatched} unmatched, ${report.closed} closed, ${report.errors} errors`,
  );
}
