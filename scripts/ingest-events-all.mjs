#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { loadMetroConfig } from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  return result.status === 0;
}

// One failing metro must not abort the rest of the loop (a Honolulu
// validation failure used to skip Austin and the coverage summary). Ingest
// every metro, collect failures, and fail the run at the end.
const failures = [];
for (const metro of metroConfig.metros) {
  if (!run(process.execPath, ["scripts/ingest-events.mjs", `--metro=${metro.id}`])) {
    failures.push(metro.id);
    continue;
  }
  if (!run(process.execPath, ["scripts/generate-featured-plans.mjs", `--metro=${metro.id}`])) {
    failures.push(metro.id);
  }
}

if (failures.length > 0) {
  console.error(`Ingest failed for ${failures.length}/${metroConfig.metros.length} metros: ${failures.join(", ")}`);
  process.exit(1);
}
console.log(`Ingest succeeded for all ${metroConfig.metros.length} metros.`);
