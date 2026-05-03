#!/usr/bin/env node
import fs from "node:fs/promises";
import {
  validateDataset,
} from "./spotPipeline.mjs";

const dataPath = process.env.SPOT_OUTPUT || "public/data/bay-area-spots.json";
const minSpots = Number(process.env.MIN_SPOTS || 150);

async function main() {
  const raw = await fs.readFile(dataPath, "utf8");
  const dataset = JSON.parse(raw);
  const errors = validateDataset(dataset, { minSpots });

  if (errors.length > 0) {
    console.error(errors.join("\n"));
    process.exit(1);
  }

  console.log(`Validated ${dataset.count} sanitized Bay Area spots.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
