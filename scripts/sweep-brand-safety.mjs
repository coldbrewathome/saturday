#!/usr/bin/env node
// One-off sweep: remove brand-unsafe venues from every metro's spot datasets.
// Kids spots.json drops weapons + cannabis + adult entertainment; adults
// spots-adults.json drops weapons only. Removal-only, no network. Legacy
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
import { brandSafetyViolation } from "./lib/brandSafety.mjs";

const metroConfig = loadMetroConfig();

function sweepFile(filePath, shouldRemove) {
  if (!fs.existsSync(filePath)) return null;
  const doc = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const spots = Array.isArray(doc.spots) ? doc.spots : [];
  const removed = [];
  const kept = spots.filter((spot) => {
    const violation = brandSafetyViolation(spot);
    if (violation && shouldRemove(violation)) {
      removed.push({ name: spot.name, violation });
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

let totalRemoved = 0;
for (const metro of metroConfig.metros) {
  const kidsFiles = [
    path.join(ROOT, metroDataFile(metro, "spots")),
    legacyMetroDataFile(metro, "spots") && path.join(ROOT, legacyMetroDataFile(metro, "spots")),
  ].filter(Boolean);
  const adultsFile = path.join(ROOT, metroDataFile(metro, "spots")).replace(/spots\.json$/, "spots-adults.json");

  for (const file of kidsFiles) {
    const result = sweepFile(file, () => true);
    if (!result || result.removed.length === 0) continue;
    totalRemoved += result.removed.length;
    console.log(`[${metro.id}] ${path.relative(ROOT, file)}: ${result.before} -> ${result.after}`);
    for (const item of result.removed) {
      console.log(`  removed (${item.violation}): ${item.name}`);
    }
  }

  const adultsResult = sweepFile(adultsFile, (violation) => violation === "weapons");
  if (adultsResult && adultsResult.removed.length > 0) {
    totalRemoved += adultsResult.removed.length;
    console.log(`[${metro.id}] ${path.relative(ROOT, adultsFile)}: ${adultsResult.before} -> ${adultsResult.after}`);
    for (const item of adultsResult.removed) {
      console.log(`  removed (${item.violation}): ${item.name}`);
    }
  }
}
console.log(`Brand-safety sweep removed ${totalRemoved} spots.`);
