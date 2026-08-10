#!/usr/bin/env node
import fs from "node:fs/promises";
import { validateEventsDataset } from "./eventPipeline.mjs";
import { qualifiesForAdultFeed } from "./lib/adultAudience.mjs";
import { auditPlanGeometry, expiredFeaturedPlanRefs } from "./lib/planQuality.mjs";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
  sourceRegistryPath,
} from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();
const rawArgs = process.argv.slice(2);
// A4: the bare command (no flags) validates every metro, same as
// validate-data.mjs — CLAUDE.md's deploy checklist and the .github
// workflows both invoke this bare, so a violating kids event or a 150-mile
// plan in any of the other 15 metros must not silently ship.
const hasExplicitMetro = rawArgs.some((arg) => arg.startsWith("--metro="));
const selection = hasExplicitMetro
  ? selectedMetroFromArgs(rawArgs, metroConfig)
  : { all: true, metro: null };

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

// D1/spec deliverable G3: events-adults.json is a live app-serving feed (the
// Mosey SPA fetches it directly) with no other validator — check every
// shipped event against the same gate the ingest writer now uses, so a
// stale or hand-edited payload with a "(Kids' Show)" offender fails the
// deploy-path command instead of shipping silently.
async function adultEventsErrors(metro) {
  const eventsPath = metroDataFile(metro, "events").replace(/events\.json$/, "events-adults.json");
  const doc = await readJsonOrNull(eventsPath);
  const errors = [];
  for (const event of doc?.events || []) {
    if (!qualifiesForAdultFeed(event)) {
      errors.push(`${eventsPath}: event "${event.title}" (${event.id}) fails qualifiesForAdultFeed.`);
    }
  }
  return errors;
}

// Popular picks are weekly editorial snapshots: a pick must resolve to an
// event in the live feed that still starts within the weekend the file names.
// Missing files are fine (the section hides without them); stale or unknown
// references are errors — they would ship a "Popular" section pointing at
// events the feed no longer carries.
async function stalePopularPickErrors(metro) {
  const eventsPath = metroDataFile(metro, "events");
  const picksPath = metroDataFile(metro, "popularEvents");
  const pairs = [
    [picksPath, eventsPath],
    [
      picksPath.replace(/popular-events\.json$/, "popular-events-adults.json"),
      eventsPath.replace(/events\.json$/, "events-adults.json"),
    ],
  ];
  const errors = [];
  for (const [picksFile, eventFile] of pairs) {
    const picksDoc = await readJsonOrNull(picksFile);
    const eventsDoc = await readJsonOrNull(eventFile);
    if (!picksDoc || !eventsDoc) continue;
    if (!Array.isArray(picksDoc.picks)) {
      errors.push(`${picksFile}: picks is not an array.`);
      continue;
    }
    const eventsById = new Map(
      (Array.isArray(eventsDoc.events) ? eventsDoc.events : []).map((e) => [e.id, e]),
    );
    for (const pick of picksDoc.picks) {
      const event = eventsById.get(pick?.eventId);
      if (!event) {
        errors.push(`${picksFile}: pick references unknown event "${pick?.eventId}".`);
        continue;
      }
      const start = new Date(event.startDateTime);
      if (!Number.isFinite(start.getTime())) continue;
      // Metro-local date, same ground truth the generator's digest uses
      // (zonedKey) — the machine's local zone is the wrong frame for a
      // Chicago event sitting near midnight CT.
      const startKey = new Intl.DateTimeFormat("en-CA", {
        timeZone: metro.timezone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(start);
      if (
        picksDoc.weekendStart &&
        (startKey < picksDoc.weekendStart || startKey > (picksDoc.weekendEnd || picksDoc.weekendStart))
      ) {
        errors.push(
          `${picksFile}: pick "${event.id}" (${event.title}) starts ${startKey}, outside ${picksDoc.weekendStart}..${picksDoc.weekendEnd}.`,
        );
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
    metroId: metro.id,
  });
  errors.push(...(await expiredPlanErrors(metro)));
  errors.push(...(await planGeometryErrors(metro)));
  errors.push(...(await adultEventsErrors(metro)));
  errors.push(...(await stalePopularPickErrors(metro)));

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
