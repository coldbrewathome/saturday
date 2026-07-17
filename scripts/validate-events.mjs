#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateEventsDataset } from "./eventPipeline.mjs";
import { auditPlanGeometry, expiredFeaturedPlanRefs } from "./lib/planQuality.mjs";
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

async function readJsonOrNull(path) {
  try {
    return await readJson(path);
  } catch {
    return null;
  }
}

// Featured plans must never point at an event that already ended (editor's
// picks served Jun-7 events as "upcoming" on Jun 9). Checks both brands'
// plan files against their own event feeds; missing files are fine, and a
// thin adults feed is NOT an error here — only stale references are.
async function expiredPlanErrors(metro) {
  const eventsPath = metroDataFile(metro, "events");
  const plansPath = metroDataFile(metro, "featuredPlans");
  const pairs = [
    [plansPath, eventsPath],
    [
      plansPath.replace(/featured-plans\.json$/, "featured-plans-adults.json"),
      eventsPath.replace(/events\.json$/, "events-adults.json"),
    ],
  ];
  const errors = [];
  for (const [planFile, eventFile] of pairs) {
    const plansDoc = await readJsonOrNull(planFile);
    const eventsDoc = await readJsonOrNull(eventFile);
    if (!plansDoc || !eventsDoc) continue;
    const eventsById = new Map(
      (Array.isArray(eventsDoc.events) ? eventsDoc.events : []).map((e) => [e.id, e]),
    );
    for (const message of expiredFeaturedPlanRefs(plansDoc.plans, eventsById)) {
      errors.push(`${planFile}: ${message}`);
    }
  }
  return errors;
}

// C2: every metro's featured plans — generated, hand-curated, kids and
// adults — must satisfy the geometry gate (pairwise radius, max leg, total
// path). A stopId that doesn't resolve to a spot is a validation failure,
// not a silent skip.
async function planGeometryErrors(metro) {
  const spotsPath = metroDataFile(metro, "spots");
  const plansPath = metroDataFile(metro, "featuredPlans");
  // Hand-curated plan stops (e.g. "Day out in X") can reference
  // curated-spots.json, not just the OSM-derived spots.json — a stop that
  // resolves fine in the app must not be misreported as "unresolvable" here.
  const curatedPath = metroDataFile(metro, "curatedSpots");
  const legacyCuratedPath = legacyMetroDataFile(metro, "curatedSpots");
  const curatedDoc =
    (await readJsonOrNull(curatedPath)) ||
    (legacyCuratedPath ? await readJsonOrNull(legacyCuratedPath) : null);
  const curatedSpots = Array.isArray(curatedDoc?.spots) ? curatedDoc.spots : [];

  const pairs = [
    [plansPath, spotsPath],
    [
      plansPath.replace(/featured-plans\.json$/, "featured-plans-adults.json"),
      spotsPath.replace(/spots\.json$/, "spots-adults.json"),
    ],
  ];
  const errors = [];
  for (const [planFile, spotsFile] of pairs) {
    const plansDoc = await readJsonOrNull(planFile);
    const spotsDoc = await readJsonOrNull(spotsFile);
    if (!plansDoc) continue;
    const spotById = new Map(
      [...(Array.isArray(spotsDoc?.spots) ? spotsDoc.spots : []), ...curatedSpots].map((s) => [s.id, s]),
    );
    const resolveStop = (stopId) => spotById.get(stopId) ?? null;
    for (const plan of plansDoc.plans || []) {
      for (const message of auditPlanGeometry(plan, resolveStop)) {
        errors.push(`${planFile}: ${message}`);
      }
    }
  }
  return errors;
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
    bbox: metro.spotCoverage?.bbox,
  });
  errors.push(...(await expiredPlanErrors(metro)));
  errors.push(...(await planGeometryErrors(metro)));

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
