#!/usr/bin/env node
// One-off sweep: remove brand-unsafe venues from every metro's spot and
// event datasets. Kids spots.json (+ curated-spots.json) drops every
// taxonomy class (weapons, cannabis, gambling, alcohol, adult, age_gated)
// and any kids events.json event at a blocklisted-venue-class (A3); adults
// spots-adults.json (+ curated-spots-adults.json) drops weapons + cannabis
// retail (A2) and kids-primary venues (D2); events-adults.json drops any
// event failing qualifiesForAdultFeed (D1). Removal-only, no network. Legacy
// mirror files (e.g. public/data/bay-area-spots.json) are swept too so
// validate-data.mjs sees the same cleaned dataset it validates.
import fs from "node:fs";
import path from "node:path";
import {
  ROOT,
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
} from "./metroConfig.mjs";
import { brandSafetyViolation, isBrandSafeForAdults, isKidsPrimaryVenue } from "./lib/brandSafety.mjs";
import { kidsEventBrandSafetyViolation } from "./eventPipeline.mjs";
import { qualifiesForAdultFeed } from "./lib/adultAudience.mjs";

const metroConfig = loadMetroConfig();

function sweepSpotFile(filePath, shouldRemove) {
  if (!fs.existsSync(filePath)) return null;
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const spots = Array.isArray(doc.spots) ? doc.spots : [];
  const removed = [];
  const kept = spots.filter((spot) => {
    const reason = shouldRemove(spot);
    if (reason) {
      removed.push({ name: spot.name, id: spot.id, violation: reason });
      return false;
    }
    return true;
  });
  if (removed.length > 0) {
    doc.spots = kept;
    if (typeof doc.count === "number") doc.count = kept.length;
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return { before: spots.length, after: kept.length, removed };
}

// A3: kids events.json drops any event at a blocklisted-venue-class,
// whatever its audiences tag says.
function sweepKidsEventsFile(filePath, metroId) {
  if (!fs.existsSync(filePath)) return null;
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const events = Array.isArray(doc.events) ? doc.events : [];
  const removed = [];
  const kept = events.filter((event) => {
    const violation = kidsEventBrandSafetyViolation(event, metroId);
    if (violation) {
      removed.push({ name: event.title, id: event.id, violation });
      return false;
    }
    return true;
  });
  if (removed.length > 0) {
    doc.events = kept;
    if (typeof doc.count === "number") doc.count = kept.length;
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return { before: events.length, after: kept.length, removed };
}

// D1: adults events.json drops any event failing the shared adult-feed gate
// (the same check the ingest writer now uses) — the exact ground-truth
// "(Kids' Show)" offenders were never swept because this file had no
// enforcement point outside a fresh ingest.
function sweepAdultEventsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const events = Array.isArray(doc.events) ? doc.events : [];
  const removed = [];
  const kept = events.filter((event) => {
    if (!qualifiesForAdultFeed(event)) {
      removed.push({ name: event.title, id: event.id, violation: "fails-qualifiesForAdultFeed" });
      return false;
    }
    return true;
  });
  if (removed.length > 0) {
    doc.events = kept;
    if (typeof doc.count === "number") doc.count = kept.length;
    fs.writeFileSync(filePath, `${JSON.stringify(doc, null, 2)}\n`);
  }
  return { before: events.length, after: kept.length, removed };
}

function report(metro, file, result) {
  if (!result || result.removed.length === 0) return 0;
  console.log(`[${metro.id}] ${path.relative(ROOT, file)}: ${result.before} -> ${result.after}`);
  for (const item of result.removed) {
    console.log(`  removed (${item.violation}): ${item.name}`);
  }
  return result.removed.length;
}

let totalRemoved = 0;
for (const metro of metroConfig.metros) {
  const kidsFiles = [
    path.join(ROOT, metroDataFile(metro, "spots")),
    legacyMetroDataFile(metro, "spots") && path.join(ROOT, legacyMetroDataFile(metro, "spots")),
  ].filter(Boolean);
  const adultsFile = path.join(ROOT, metroDataFile(metro, "spots")).replace(/spots\.json$/, "spots-adults.json");
  // bay-area's events.json has a legacy top-level mirror
  // (public/data/events.json), same as its spots legacy mirror — and
  // validate-events.mjs reads the legacy path first, so it must be swept too.
  const kidsEventsFiles = [
    path.join(ROOT, metroDataFile(metro, "events")),
    legacyMetroDataFile(metro, "events") && path.join(ROOT, legacyMetroDataFile(metro, "events")),
  ].filter(Boolean);
  const adultsEventsFile = path.join(ROOT, metroDataFile(metro, "events")).replace(/events\.json$/, "events-adults.json");
  const curatedFile = path.join(ROOT, metroDataFile(metro, "curatedSpots"));
  const legacyCuratedFile = legacyMetroDataFile(metro, "curatedSpots") && path.join(ROOT, legacyMetroDataFile(metro, "curatedSpots"));
  const curatedAdultsFile = path.join(ROOT, metroDataFile(metro, "spots")).replace(/spots\.json$/, "curated-spots-adults.json");

  for (const file of kidsFiles) {
    totalRemoved += report(metro, file, sweepSpotFile(file, (spot) => brandSafetyViolation({ ...spot, metro: metro.id })));
  }

  for (const file of [curatedFile, legacyCuratedFile].filter(Boolean)) {
    totalRemoved += report(metro, file, sweepSpotFile(file, (spot) => brandSafetyViolation({ ...spot, metro: metro.id })));
  }

  const adultsShouldRemove = (spot) => {
    const probe = { ...spot, metro: metro.id };
    if (!isBrandSafeForAdults(probe)) return brandSafetyViolation(probe);
    if (isKidsPrimaryVenue(probe)) return "kids-primary-venue";
    return null;
  };
  totalRemoved += report(metro, adultsFile, sweepSpotFile(adultsFile, adultsShouldRemove));
  totalRemoved += report(metro, curatedAdultsFile, sweepSpotFile(curatedAdultsFile, adultsShouldRemove));

  for (const file of kidsEventsFiles) {
    totalRemoved += report(metro, file, sweepKidsEventsFile(file, metro.id));
  }
  totalRemoved += report(metro, adultsEventsFile, sweepAdultEventsFile(adultsEventsFile));
}
console.log(`Brand-safety sweep removed ${totalRemoved} spots/events.`);
