#!/usr/bin/env node
// One-off sweep: remove brand-unsafe venues from every metro's spot and
// event datasets. Kids spots.json drops every taxonomy class (weapons,
// cannabis, gambling, alcohol, adult, age_gated) and any kids events.json
// event at a blocklisted-venue-class (A3); adults spots-adults.json drops
// weapons + cannabis retail (A2) and kids-primary venues (D2). Removal-only,
// no network. Legacy mirror files (e.g. public/data/bay-area-spots.json) are
// swept too so validate-data.mjs sees the same cleaned dataset it validates.
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
function sweepKidsEventsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const events = Array.isArray(doc.events) ? doc.events : [];
  const removed = [];
  const kept = events.filter((event) => {
    const violation = kidsEventBrandSafetyViolation(event);
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
  const kidsEventsFile = path.join(ROOT, metroDataFile(metro, "events"));

  for (const file of kidsFiles) {
    totalRemoved += report(metro, file, sweepSpotFile(file, (spot) => brandSafetyViolation(spot)));
  }

  totalRemoved += report(
    metro,
    adultsFile,
    sweepSpotFile(adultsFile, (spot) => {
      if (!isBrandSafeForAdults(spot)) return brandSafetyViolation(spot);
      if (isKidsPrimaryVenue(spot)) return "kids-primary-venue";
      return null;
    }),
  );

  totalRemoved += report(metro, kidsEventsFile, sweepKidsEventsFile(kidsEventsFile));
}
console.log(`Brand-safety sweep removed ${totalRemoved} spots/events.`);
