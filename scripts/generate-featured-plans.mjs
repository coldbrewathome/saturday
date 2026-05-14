#!/usr/bin/env node
// Build per-city editor's-pick plans from a metro's live spot + event datasets.
// Default is Bay Area for backward compatibility; pass --all to rebuild every
// configured metro.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
} from "./metroConfig.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(process.argv.slice(2), metroConfig);

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function readJsonOrEmpty(p, fallback) {
  try {
    return readJson(p);
  } catch {
    return fallback;
  }
}

function metroJson(metro, key, fallback) {
  const primary = path.join(ROOT, metroDataFile(metro, key));
  const doc = readJsonOrEmpty(primary, null);
  if (doc) return doc;
  const legacy = legacyMetroDataFile(metro, key);
  return legacy ? readJsonOrEmpty(path.join(ROOT, legacy), fallback) : fallback;
}

function writeJsonWithLegacy(metro, key, doc) {
  const primary = path.join(ROOT, metroDataFile(metro, key));
  fs.mkdirSync(path.dirname(primary), { recursive: true });
  fs.writeFileSync(primary, JSON.stringify(doc, null, 2) + "\n");

  const legacy = legacyMetroDataFile(metro, key);
  if (legacy) {
    const legacyPath = path.join(ROOT, legacy);
    fs.mkdirSync(path.dirname(legacyPath), { recursive: true });
    fs.writeFileSync(legacyPath, JSON.stringify(doc, null, 2) + "\n");
  }
}

function normalizeCity(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  return parts.length >= 2 ? parts[parts.length - 1] : trimmed;
}

function groupSpotsByCity(spots) {
  const map = new Map();
  for (const spot of spots) {
    const city = normalizeCity(spot.neighborhood) || normalizeCity(spot.city);
    if (!city) continue;
    if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) continue;
    if (!map.has(city)) map.set(city, []);
    map.get(city).push(spot);
  }
  return map;
}

function groupUpcomingEventsByCity(events) {
  const now = Date.now();
  const futureLimit = now + 14 * 24 * 60 * 60 * 1000;
  const map = new Map();
  for (const event of events) {
    const city = normalizeCity(event.city) || normalizeCity(event.neighborhood);
    if (!city) continue;
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;
    if (!event.startDateTime) continue;
    const t = new Date(event.startDateTime).getTime();
    if (!Number.isFinite(t) || t < now - 6 * 60 * 60 * 1000 || t > futureLimit) continue;
    if (!map.has(city)) map.set(city, []);
    map.get(city).push(event);
  }
  return map;
}

const CHAIN_FOOD_RE =
  /\b(mcdonald'?s|burger king|kfc|domino'?s|subway|starbucks|taco bell|wendy'?s|jack in the box|pizza hut|panda express)\b/i;

function isPlanAnchorSpot(spot) {
  const haystack = `${spot.name || ""} ${spot.category || ""} ${spot.tags?.join(" ") || ""}`;
  if (CHAIN_FOOD_RE.test(haystack)) return false;
  if (spot.category === "Food" || spot.category === "Shopping") {
    return /market|farm|bakery|cafe|ice cream|book|toy|mall|plaza|food hall/i.test(haystack);
  }
  return true;
}

function pickTopSpots(spots, count) {
  const preferred = spots.filter(isPlanAnchorSpot);
  const pool =
    preferred.length >= count
      ? preferred
      : [...preferred, ...spots.filter((spot) => !preferred.includes(spot))];
  return pool
    .sort((a, b) => (b.friendScore || 0) - (a.friendScore || 0))
    .slice(0, count);
}

function pickNextEvents(list, count) {
  return [...list]
    .sort(
      (a, b) =>
        new Date(a.startDateTime).getTime() -
        new Date(b.startDateTime).getTime(),
    )
    .slice(0, count);
}

function centroid(items) {
  if (!items.length) return null;
  const lat = items.reduce((sum, it) => sum + Number(it.lat || 0), 0) / items.length;
  const lon = items.reduce((sum, it) => sum + Number(it.lon || 0), 0) / items.length;
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
}

function inferAccent(spots) {
  for (const spot of spots) {
    if (spot.category === "Outdoors" || spot.category === "Wellness") return "park";
    if (spot.category === "Culture") return "festival";
  }
  return "park";
}

function slugCity(city) {
  return city
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

function buildPlans(spots, events, { namePrefix = "Day out", audiences = ["all"] } = {}) {
  const spotsByCity = groupSpotsByCity(spots);
  const eventsByCity = groupUpcomingEventsByCity(events);
  const generated = [];
  const cities = Array.from(
    new Set([...spotsByCity.keys(), ...eventsByCity.keys()]),
  ).sort();

  for (const city of cities) {
    const citySpots = spotsByCity.get(city) || [];
    const cityEvents = eventsByCity.get(city) || [];
    const cityAnchorSpots = citySpots.filter(isPlanAnchorSpot);
    if (citySpots.length < 2 && cityEvents.length === 0) continue;
    const slug = slugCity(city);

    if (cityAnchorSpots.length >= 2) {
      const picks = pickTopSpots(
        cityAnchorSpots,
        Math.min(3, cityAnchorSpots.length),
      );
      const center = centroid(picks);
      const summary = `${picks.length} stops in ${city} - ${picks
            .map((p) => p.name.split(",")[0])
            .join(", ")}.`;
      generated.push({
        id: `gen-day-${slug}`,
        name: `${namePrefix} in ${city}`,
        summary: summary.slice(0, 220),
        accent: inferAccent(picks),
        stopIds: picks.map((p) => p.id),
        eventIds: [],
        audiences,
        city,
        lat: center?.lat ?? null,
        lon: center?.lon ?? null,
        generated: true,
      });
    }

    if (cityEvents.length >= 2 && cityAnchorSpots.length >= 1) {
      const eventPicks = pickNextEvents(cityEvents, 2);
      const spotPick = pickTopSpots(cityAnchorSpots, 1);
      const items = [...spotPick, ...eventPicks];
      const center = centroid(items);
      const summary = `Two upcoming events in ${city} plus a nearby stop - ${eventPicks
        .map((e) => e.title.slice(0, 60))
        .join(" | ")}.`;
      generated.push({
        id: `gen-events-${slug}`,
        name: `${city} events`,
        summary: summary.slice(0, 240),
        accent: "festival",
        stopIds: spotPick.map((s) => s.id),
        eventIds: eventPicks.map((e) => e.id),
        audiences,
        city,
        lat: center?.lat ?? null,
        lon: center?.lon ?? null,
        generated: true,
      });
    }
  }
  return { generated, cityCount: cities.length };
}

function generateForMetro(metro) {
  const plansDoc = metroJson(metro, "featuredPlans", { plans: [] });
  const curatedDoc = metroJson(metro, "curatedSpots", { spots: [] });
  const handCurated = (plansDoc.plans || []).filter((p) => !p.generated);

  const kidsSpotsDoc = readJsonOrEmpty(path.join(ROOT, metroDataFile(metro, "spots")), { spots: [] });
  const kidsEventsDoc = readJsonOrEmpty(path.join(ROOT, metroDataFile(metro, "events")), { events: [] });
  const kidsSpots = [
    ...(Array.isArray(kidsSpotsDoc.spots) ? kidsSpotsDoc.spots : []),
    ...(Array.isArray(curatedDoc.spots) ? curatedDoc.spots : []),
  ];
  const kidsEvents = Array.isArray(kidsEventsDoc.events) ? kidsEventsDoc.events : [];

  const kids = buildPlans(kidsSpots, kidsEvents, { namePrefix: "Day out", audiences: ["all"] });
  const kidsFinal = [...handCurated, ...kids.generated];
  const kidsOut = {
    schemaVersion: 2,
    metroId: metro.id,
    note: "Auto-generated per-city plans for kids audience.",
    plans: kidsFinal,
  };
  writeJsonWithLegacy(metro, "featuredPlans", kidsOut);
  console.log(
    `[featured-plans:${metro.id}] kept ${handCurated.length} hand-curated, generated ${kids.generated.length} from ${kids.cityCount} cities -> ${kidsFinal.length} total`,
  );

  const adultsSpotPath = path.join(ROOT, metroDataFile(metro, "spots")).replace(/spots\.json$/, "spots-adults.json");
  const adultsEventPath = path.join(ROOT, metroDataFile(metro, "events")).replace(/events\.json$/, "events-adults.json");
  const adultsSpotsDoc = readJsonOrEmpty(adultsSpotPath, { spots: [] });
  const adultsEventsDoc = readJsonOrEmpty(adultsEventPath, { events: [] });
  const adultsSpots = Array.isArray(adultsSpotsDoc.spots) ? adultsSpotsDoc.spots : [];
  const adultsEvents = Array.isArray(adultsEventsDoc.events) ? adultsEventsDoc.events : [];

  const adults = buildPlans(adultsSpots, adultsEvents, { namePrefix: "Night out", audiences: ["adults"] });
  const adultsOut = {
    schemaVersion: 2,
    metroId: metro.id,
    note: "Auto-generated per-city plans for adults audience.",
    plans: adults.generated,
  };
  const adultsOutPath = path.join(ROOT, metroDataFile(metro, "featuredPlans")).replace(/featured-plans\.json$/, "featured-plans-adults.json");
  fs.mkdirSync(path.dirname(adultsOutPath), { recursive: true });
  fs.writeFileSync(adultsOutPath, JSON.stringify(adultsOut, null, 2) + "\n");
  console.log(
    `[featured-plans-adults:${metro.id}] generated ${adults.generated.length} from ${adults.cityCount} cities`,
  );
}

for (const metro of selection.all ? metroConfig.metros : [selection.metro]) {
  generateForMetro(metro);
}
