// One-shot backfill: add `themes[]` to every event in the existing
// public/data/**/events*.json files. New scans get themes automatically via
// buildEventsDataset (eventPipeline.mjs); this catches data written before
// that wiring. Idempotent — re-running just recomputes themes.

import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from "node:fs";
import path from "node:path";
import { classifyEventThemes } from "./eventThemes.mjs";

const DATA_ROOT = path.join(process.cwd(), "public", "data");

function* eventFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) {
      yield* eventFiles(full);
    } else if (/^events(-adults)?\.json$/.test(entry)) {
      yield full;
    }
  }
}

let files = 0;
let events = 0;
for (const file of eventFiles(DATA_ROOT)) {
  const doc = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(doc.events)) continue;
  for (const event of doc.events) {
    event.themes = classifyEventThemes(event);
    events += 1;
  }
  writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
  files += 1;
  console.log(`  ${path.relative(process.cwd(), file)} — ${doc.events.length} events`);
}

console.log(`\nBackfilled themes into ${events} events across ${files} files.`);
if (!existsSync(DATA_ROOT)) {
  console.error("No public/data directory found.");
  process.exit(1);
}
