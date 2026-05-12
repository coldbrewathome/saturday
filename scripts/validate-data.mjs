#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateDataset } from "./spotPipeline.mjs";
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
