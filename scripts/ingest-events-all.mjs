#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { loadMetroConfig } from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();

function run(command, args) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

for (const metro of metroConfig.metros) {
  run(process.execPath, ["scripts/ingest-events.mjs", `--metro=${metro.id}`]);
  run(process.execPath, [
    "scripts/generate-featured-plans.mjs",
    `--metro=${metro.id}`,
  ]);
}
