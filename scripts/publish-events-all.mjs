#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { loadMetroConfig } from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();

for (const metro of metroConfig.metros) {
  const result = spawnSync(process.execPath, [
    "scripts/publish-events.mjs",
    `--metro=${metro.id}`,
  ], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
