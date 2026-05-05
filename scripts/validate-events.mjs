#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateEventsDataset } from "./eventPipeline.mjs";

const dataPath = process.env.EVENT_OUTPUT || "public/data/events.json";
const registryPath = process.env.EVENT_SOURCES || "data/event-sources.json";
const minEvents = Number(process.env.MIN_EVENTS || 25);

async function readJson(path) {
  return JSON.parse(await fs.readFile(path, "utf8"));
}

async function main() {
  const dataset = await readJson(dataPath);
  const registry = await readJson(registryPath);
  const errors = validateEventsDataset(dataset, {
    minEvents,
    cities: registry.coverage?.cities || [],
    communities: ["Muir Beach", "Bay Area"],
  });

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  console.log(`Validated ${dataset.events.length} Bay Area events.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
