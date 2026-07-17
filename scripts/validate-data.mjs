#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateDataset } from "./spotPipeline.mjs";
import { brandSafetyViolation, isBrandSafeForAdults, isKidsPrimaryVenue } from "./lib/brandSafety.mjs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();
const rawArgs = process.argv.slice(2);
// A4: the bare command (no flags) validates every metro — crawl-budget and
// brand-safety gates must not depend on remembering to pass --all. --metro=
// still scopes to one metro; --all is still accepted explicitly.
const hasExplicitMetro = rawArgs.some((arg) => arg.startsWith("--metro="));
const selection = hasExplicitMetro
  ? selectedMetroFromArgs(rawArgs, metroConfig)
  : { all: true, metro: null };

async function readJsonOrNull(path) {
  try {
    return JSON.parse(await fs.readFile(path, "utf8"));
  } catch {
    return null;
  }
}

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
  // gambling, alcohol, adult, age-gated). Hard-fail so a bad ingest can't ship.
  for (const spot of dataset.spots || []) {
    const violation = brandSafetyViolation(spot);
    if (violation) {
      errors.push(`spot "${spot.name}" (${spot.id}) is blocklisted for kids: ${violation}.`);
    }
  }

  // D2: adults spots must never contain weapons/cannabis-retail venues or
  // kids-primary venues (playgrounds, children's museums/gyms).
  const adultsPath = dataPath.replace(/spots\.json$/, "spots-adults.json");
  const adultsDataset = await readJsonOrNull(adultsPath);
  for (const spot of adultsDataset?.spots || []) {
    if (!isBrandSafeForAdults(spot)) {
      errors.push(`adults spot "${spot.name}" (${spot.id}) is blocklisted: ${brandSafetyViolation(spot)}.`);
    }
    if (isKidsPrimaryVenue(spot)) {
      errors.push(`adults spot "${spot.name}" (${spot.id}) is a kids-primary venue.`);
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
