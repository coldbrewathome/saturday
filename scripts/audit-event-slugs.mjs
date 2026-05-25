#!/usr/bin/env node
// Per ADR-04: enforce stable, unique event slugs across published event
// datasets. Mirrors the spot-slug audit baked into validate-all-seo.mjs, but
// runs against the source-of-truth events.json (and events-adults.json) so
// the failure is caught at validate:events time, not at build time.
//
// Checks per dataset:
//   1. every event has a string `slug`
//   2. recomputing the slug via assignEventSlugs() matches the on-disk slug
//      (catches drift between pipeline code and the published file)
//   3. slugs are unique within the dataset, *except* when colliding events
//      share a stable identity (baseId, or id for one-offs). Per ADR-04,
//      multiple occurrences of the same recurring template intentionally
//      collapse to a single canonical URL.
//
// Run with: node scripts/audit-event-slugs.mjs [--metro=<slug> | --all]

import fs from "node:fs/promises";
import { assignEventSlugs } from "./eventPipeline.mjs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(process.argv.slice(2), metroConfig);

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await fs.readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

function auditDataset(label, dataset) {
  const errors = [];
  if (!dataset || !Array.isArray(dataset.events)) {
    return [`${label}: dataset has no events array`];
  }
  // Clone so the recompute pass doesn't mutate on-disk objects.
  const recomputed = assignEventSlugs(
    dataset.events.map((event) => ({ ...event, slug: undefined })),
  );
  // Group events by slug so we can distinguish "intentional collapse of a
  // recurring template" from "two distinct events landed on the same URL".
  const bySlug = new Map();
  for (let i = 0; i < dataset.events.length; i++) {
    const event = dataset.events[i];
    const expected = recomputed[i]?.slug;
    const actual = event.slug;
    const prefix = `${label} events[${i}] (id=${event.id || "?"})`;
    if (typeof actual !== "string" || actual.length === 0) {
      errors.push(`${prefix}: missing slug`);
      continue;
    }
    if (expected && actual !== expected) {
      errors.push(
        `${prefix}: slug drift — on disk "${actual}" but pipeline would produce "${expected}". Re-run ingest:events.`,
      );
    }
    if (!bySlug.has(actual)) bySlug.set(actual, []);
    bySlug.get(actual).push({ index: i, event });
  }
  for (const [slug, group] of bySlug) {
    if (group.length < 2) continue;
    const stableIds = new Set(
      group.map(({ event }) => event.baseId || event.id || ""),
    );
    if (stableIds.size > 1) {
      const ids = group
        .map(({ index, event }) => `events[${index}]=${event.id || "?"}`)
        .join(", ");
      errors.push(
        `${label}: slug "${slug}" collides across distinct events (${ids})`,
      );
    }
  }
  return errors;
}

async function auditMetro(metro) {
  // Audit every published events.json + events-adults.json file we know
  // about — both the modern per-metro path and the legacy
  // public/data/events.json shim that ingest-events still writes for
  // bay-area. If a metro has both, both must pass.
  const candidates = [];
  const modernKids = metroDataFile(metro, "events");
  const legacyKids = legacyMetroDataFile(metro, "events");
  for (const kidsPath of [modernKids, legacyKids].filter(Boolean)) {
    candidates.push({ label: `[${metro.id}] kids ${kidsPath}`, path: kidsPath });
    const adultsPath = kidsPath.replace(/events\.json$/, "events-adults.json");
    candidates.push({
      label: `[${metro.id}] adults ${adultsPath}`,
      path: adultsPath,
    });
  }

  const errors = [];
  let totalEvents = 0;
  for (const { label, path } of candidates) {
    const dataset = await readJsonOrNull(path);
    if (!dataset) continue;
    errors.push(...auditDataset(label, dataset));
    totalEvents += dataset.events?.length ?? 0;
  }

  if (errors.length > 0) {
    for (const err of errors) console.error(err);
    return false;
  }

  console.log(`Audited ${totalEvents} event slugs for ${metro.label}.`);
  return true;
}

async function main() {
  const metros = selection.all ? metroConfig.metros : [selection.metro];
  let ok = true;
  for (const metro of metros) {
    const passed = await auditMetro(metro);
    if (!passed) ok = false;
  }
  if (!ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
