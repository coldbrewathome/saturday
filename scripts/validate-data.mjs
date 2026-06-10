#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateDataset } from "./spotPipeline.mjs";
import { brandSafetyViolation } from "./lib/brandSafety.mjs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(process.argv.slice(2), metroConfig);

async function validateMetro(metro) {
  const dataPath =
    process.env.SPOT_OUTPUT ||
    legacyMetroDataFile(metro, "spots") ||
    metroDataFile(metro, "spots");
  const minSpots = Number(process.env.MIN_SPOTS || metro.minSpots || 150);
  const raw = await fs.readFile(dataPath, "utf8");
  const dataset = JSON.parse(raw);
  const errors = validateDataset(dataset, {
    minSpots,
    boxes: metro.spotCoverage?.boxes,
    coverageName: metro.spotCoverage?.name || metro.label,
  });

  // Kids spots must never contain brand-unsafe venues (weapons, cannabis,
  // adult entertainment). Hard-fail so a bad ingest can't ship.
  for (const spot of dataset.spots || []) {
    const violation = brandSafetyViolation(spot);
    if (violation) {
      errors.push(`spot "${spot.name}" (${spot.id}) is blocklisted for kids: ${violation}.`);
    }
  }

  if (errors.length > 0) {
    console.error(`[${metro.id}] ${errors.join(`\n[${metro.id}] `)}`);
    process.exit(1);
  }

  console.log(`Validated ${dataset.count} sanitized ${metro.label} spots.`);
}

async function main() {
  const metros = selection.all ? metroConfig.metros : [selection.metro];
  for (const metro of metros) {
    await validateMetro(metro);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
