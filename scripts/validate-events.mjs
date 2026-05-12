#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateEventsDataset } from "./eventPipeline.mjs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
  sourceRegistryPath,
} from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(process.argv.slice(2), metroConfig);

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function validateMetro(metro) {
  const dataPath =
    process.env.EVENT_OUTPUT ||
    legacyMetroDataFile(metro, "events") ||
    metroDataFile(metro, "events");
  const registryPath = process.env.EVENT_SOURCES || sourceRegistryPath(metro);
  const minEvents = Number(process.env.MIN_EVENTS || metro.minEvents || 25);
  const dataset = await readJson(dataPath);
  const registry = await readJson(registryPath);
  const errors = validateEventsDataset(dataset, {
    minEvents,
    cities: registry.coverage?.cities || [],
    communities: [
      registry.coverage?.name,
      metro.label,
      metro.seoName,
      ...(metro.eventCommunities || []),
    ].filter(Boolean),
  });

  if (errors.length > 0) {
    console.error(`[${metro.id}] ${errors.join(`\n[${metro.id}] `)}`);
    process.exit(1);
  }

  console.log(`Validated ${dataset.events.length} ${metro.label} events.`);
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
