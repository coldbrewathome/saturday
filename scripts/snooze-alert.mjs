#!/usr/bin/env node
// Local-only CLI to snooze an operator alert by sourceId. Writes to
// `data/alert-snoozes.json` (tracked in git so snoozes survive across
// operators / CI). The triage UI greys out alerts whose sourceId is
// snoozed; on the next ingest, `scripts/ingest-events.mjs` re-applies
// the tag automatically.
//
// Usage:
//   node scripts/snooze-alert.mjs <sourceId> --until=<ISO> [--note="..."]
//   node scripts/snooze-alert.mjs <sourceId> --days=7 [--note="..."]
//
// One of --until or --days is required. --days is a convenience that
// resolves to `now + N * 86400s` in ISO. The CLI never reaches the
// network — it only edits the local JSON file.

import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  SNOOZES_PATH_REL,
  readSnoozesFile,
  upsertSnooze,
  writeSnoozesFile,
} from "./alertSnoozes.mjs";
import { ROOT } from "./metroConfig.mjs";

function usage() {
  console.log(`Usage:
  node scripts/snooze-alert.mjs <sourceId> --until=<ISO> [--note="..."]
  node scripts/snooze-alert.mjs <sourceId> --days=<N>    [--note="..."]

Writes to ${SNOOZES_PATH_REL}. One of --until or --days is required.`);
}

export function parseSnoozeArgs(argv = process.argv.slice(2)) {
  const options = { sourceId: null, until: null, days: null, note: null, help: false };
  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("--until=")) {
      options.until = arg.slice("--until=".length);
    } else if (arg.startsWith("--days=")) {
      const n = Number(arg.slice("--days=".length));
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--days must be a positive number.");
      }
      options.days = n;
    } else if (arg.startsWith("--note=")) {
      options.note = arg.slice("--note=".length);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (options.sourceId === null) {
      options.sourceId = arg;
    } else {
      throw new Error(`Unexpected positional argument: ${arg}`);
    }
  }
  if (options.help) return options;
  if (!options.sourceId) throw new Error("Missing required <sourceId>.");
  if (!options.until && !options.days) {
    throw new Error("One of --until=<ISO> or --days=<N> is required.");
  }
  if (options.until && options.days) {
    throw new Error("Use either --until or --days, not both.");
  }
  return options;
}

export function resolveUntil(options, now = new Date()) {
  if (options.until) {
    const ms = Date.parse(options.until);
    if (!Number.isFinite(ms)) {
      throw new Error(`--until is not a valid ISO timestamp: ${options.until}`);
    }
    if (ms <= now.getTime()) {
      throw new Error(`--until is in the past: ${options.until}`);
    }
    return new Date(ms).toISOString();
  }
  return new Date(now.getTime() + options.days * 86400 * 1000).toISOString();
}

function main() {
  const options = parseSnoozeArgs();
  if (options.help) {
    usage();
    return;
  }
  const now = new Date();
  const until = resolveUntil(options, now);
  const doc = readSnoozesFile(ROOT);
  const nextDoc = upsertSnooze(
    doc,
    { sourceId: options.sourceId, until, note: options.note ?? undefined },
    now,
  );
  const absolute = writeSnoozesFile(ROOT, nextDoc);
  const rel = path.relative(ROOT, absolute);
  console.log(`[snooze-alert] ${options.sourceId} -> ${until} (${rel})`);
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === currentFile) {
  try {
    main();
  } catch (error) {
    console.error(`[snooze-alert] ${error.message}`);
    process.exit(1);
  }
}
