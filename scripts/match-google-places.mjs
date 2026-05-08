#!/usr/bin/env node
/**
 * One-time matcher: enrich curated-spots.json with canonical Google Places data.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=AIza... node scripts/match-google-places.mjs
 *
 * Optional flags:
 *   --dry-run                Don't write back; only emit match-report.json.
 *   --limit=N                Only process the first N entries (handy for testing).
 *   --keep-closed            Keep entries Google flags CLOSED_PERMANENTLY
 *                            (default: move them to a "dropped" list).
 *   --no-photos              Skip the Place Photos call (saves ~$0.007/entry).
 *
 * What it does for each curated spot:
 *   1. Find Place from Text using "{name} {neighborhood}, CA"
 *      (Places API "v1:places:searchText" — new endpoint, includes
 *      formattedAddress, location, business_status).
 *   2. Place Details on the matched place_id (website, phone, opening hours,
 *      first photo reference).
 *   3. Place Photo Media (skipHttpRedirect=true) to resolve the photo to a
 *      stable CDN URL we can store and serve directly.
 *   4. Merges canonical fields into the entry, sets verified=true when
 *      OPERATIONAL, leaves verified=false when uncertain.
 *
 * Cost: ~$0.041 per entry (Text Search + Details + Photo Media). ~$3.60 for 86
 * entries. Use --no-photos to drop to ~$0.034 / ~$3.
 */
import { readFileSync, writeFileSync } from "node:fs";
import {
  CATEGORY_INCLUDED_TYPE,
  buildEnrichment,
  buildQuery,
  createPlacesClient,
} from "./lib/places-match.mjs";

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
if (!apiKey) {
  console.error("Missing GOOGLE_PLACES_API_KEY env var.");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keepClosed = args.includes("--keep-closed");
const skipPhotos = args.includes("--no-photos");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

const filePath = "public/data/curated-spots.json";
const reportPath = "public/data/curated-spots-match-report.json";
const file = JSON.parse(readFileSync(filePath, "utf8"));
const spots = Array.isArray(file.spots) ? file.spots : [];

const client = createPlacesClient(apiKey);

const report = {
  generatedAt: new Date().toISOString(),
  total: 0,
  matched: 0,
  unmatched: 0,
  closed: 0,
  errors: 0,
  entries: [],
};

const updatedSpots = [];
const droppedSpots = [];

const toProcess = spots.slice(0, Math.min(spots.length, limit));
console.log(`Matching ${toProcess.length} of ${spots.length} entries…`);

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
      report.entries.push({ id: spot.id, query, status: "no-match" });
      updatedSpots.push(spot);
      console.log(`[${i + 1}/${toProcess.length}] ✗ no match  ${spot.id}`);
      continue;
    }
    const details = await client.placeDetails(match.id);
    const status = details.businessStatus || match.businessStatus || "OPERATIONAL";
    if (status === "CLOSED_PERMANENTLY" && !keepClosed) {
      report.closed += 1;
      droppedSpots.push({
        ...spot,
        googlePlaceId: match.id,
        businessStatus: status,
      });
      report.entries.push({
        id: spot.id,
        query,
        status: "dropped-closed",
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
    const enrichment = buildEnrichment({ spot, match, details, photo });
    const enriched = { ...spot, ...enrichment };
    report.matched += 1;
    report.entries.push({
      id: spot.id,
      query,
      status: "matched",
      placeId: match.id,
      address: enriched.address,
      operational: status === "OPERATIONAL",
    });
    updatedSpots.push(enriched);
    console.log(
      `[${i + 1}/${toProcess.length}] ✓ ${spot.id}  →  ${match.displayName?.text || match.id}`,
    );
  } catch (error) {
    report.errors += 1;
    report.entries.push({
      id: spot.id,
      query,
      status: "error",
      error: error.message,
    });
    updatedSpots.push(spot);
    console.error(
      `[${i + 1}/${toProcess.length}] ! error    ${spot.id}: ${error.message}`,
    );
  }
}

if (toProcess.length < spots.length) {
  for (let i = toProcess.length; i < spots.length; i += 1) {
    updatedSpots.push(spots[i]);
  }
}

if (!dryRun) {
  const next = {
    ...file,
    generatedAt: new Date().toISOString(),
    spots: updatedSpots,
    droppedSpots: droppedSpots.length > 0 ? droppedSpots : undefined,
  };
  writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nWrote ${updatedSpots.length} spots to ${filePath}`);
  if (droppedSpots.length > 0) {
    console.log(`Dropped ${droppedSpots.length} CLOSED_PERMANENTLY entries.`);
  }
} else {
  console.log("\n(dry run — file not modified)");
}

writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Report written to ${reportPath}`);
console.log(
  `Summary: ${report.matched} matched, ${report.unmatched} unmatched, ${report.closed} closed, ${report.errors} errors`,
);
