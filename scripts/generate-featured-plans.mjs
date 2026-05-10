#!/usr/bin/env node
// Build per-city editor's-pick plans from the live spot + event datasets.
//
// Output: public/data/featured-plans.json
//
// Strategy:
//   1. Hand-curated plans (the SF Presidio toddler day, etc.) stay at the
//      top — they are written, not generated.
//   2. For every Bay Area city that has at least 3 spots, append a generic
//      "Family day in {city}" plan composed of the 3 highest-friend-score
//      spots in that city.
//   3. For every city that ALSO has 2+ upcoming dated events, append a
//      "{city} family events" plan that mixes 1 spot + the next 2 events
//      so the rail surfaces something time-sensitive.
//   4. Each generated plan also carries lat/lon (centroid of its items) and
//      a city field. The frontend uses those to show only plans near the
//      visible map area.
//
// The hand-written plans at the top of featured-plans.json are recognized
// by their lack of a `generated: true` flag; this script preserves them
// across runs and only rewrites the generated suffix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PLANS_PATH = path.join(ROOT, "public", "data", "featured-plans.json");
const SPOTS_PATH = path.join(ROOT, "public", "data", "bay-area-spots.json");
const EVENTS_PATH = path.join(ROOT, "public", "data", "events.json");
const CURATED_SPOTS_PATH = path.join(ROOT, "public", "data", "curated-spots.json");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

const plansDoc = readJson(PLANS_PATH);
const spotsDoc = readJson(SPOTS_PATH);
const eventsDoc = readJson(EVENTS_PATH);
let curatedSpots = [];
try {
  const cur = readJson(CURATED_SPOTS_PATH);
  curatedSpots = Array.isArray(cur?.spots) ? cur.spots : [];
} catch {
  // optional
}

const allSpots = [
  ...(Array.isArray(spotsDoc?.spots) ? spotsDoc.spots : []),
  ...curatedSpots,
];
const events = Array.isArray(eventsDoc?.events) ? eventsDoc.events : [];

// Snap `neighborhood` strings to a canonical city name. The OSM data sometimes
// has neighborhood values like "Bernal Heights, San Francisco" — collapse to
// the city.
function normalizeCity(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Strip leading neighborhood when followed by a comma + city.
  const parts = trimmed.split(",").map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return parts[parts.length - 1];
  return trimmed;
}

const spotsByCity = new Map();
for (const spot of allSpots) {
  const city = normalizeCity(spot.neighborhood) || normalizeCity(spot.city);
  if (!city) continue;
  if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) continue;
  if (!spotsByCity.has(city)) spotsByCity.set(city, []);
  spotsByCity.get(city).push(spot);
}

const now = Date.now();
const futureLimit = now + 14 * 24 * 60 * 60 * 1000;
const eventsByCity = new Map();
for (const event of events) {
  const city = normalizeCity(event.city) || normalizeCity(event.neighborhood);
  if (!city) continue;
  if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) continue;
  if (!event.startDateTime) continue;
  const t = new Date(event.startDateTime).getTime();
  if (!Number.isFinite(t) || t < now - 6 * 60 * 60 * 1000 || t > futureLimit) {
    continue;
  }
  if (!eventsByCity.has(city)) eventsByCity.set(city, []);
  eventsByCity.get(city).push(event);
}

// Order spots within each city by friendScore so the highest-quality
// stops feed into the auto-generated plans.
function pickTopSpots(spots, count) {
  return [...spots]
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
  const lat =
    items.reduce((sum, it) => sum + Number(it.lat || 0), 0) / items.length;
  const lon =
    items.reduce((sum, it) => sum + Number(it.lon || 0), 0) / items.length;
  return { lat: Number(lat.toFixed(5)), lon: Number(lon.toFixed(5)) };
}

function inferAccent(spots) {
  for (const s of spots) {
    if (s.category === "Outdoors" || s.category === "Wellness") return "park";
    if (s.category === "Culture") return "festival";
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

const handCurated = (plansDoc.plans || []).filter((p) => !p.generated);
const generated = [];

const cities = Array.from(
  new Set([...spotsByCity.keys(), ...eventsByCity.keys()]),
).sort();

for (const city of cities) {
  const citySpots = spotsByCity.get(city) || [];
  const cityEvents = eventsByCity.get(city) || [];
  if (citySpots.length < 2 && cityEvents.length === 0) continue;

  const slug = slugCity(city);

  // Plan A: "Family day in {city}" — 3 top spots.
  if (citySpots.length >= 2) {
    const picks = pickTopSpots(citySpots, Math.min(3, citySpots.length));
    const center = centroid(picks);
    const summary = picks.length === 3
      ? `Three family-friendly stops in ${city} — ${picks
          .map((p) => p.name.split(",")[0])
          .join(", ")}.`
      : `Family-friendly spots in ${city} — ${picks
          .map((p) => p.name.split(",")[0])
          .join(", ")}.`;
    generated.push({
      id: `gen-day-${slug}`,
      name: `Family day in ${city}`,
      summary: summary.slice(0, 220),
      accent: inferAccent(picks),
      stopIds: picks.map((p) => p.id),
      eventIds: [],
      audiences: ["all"],
      city,
      lat: center?.lat ?? null,
      lon: center?.lon ?? null,
      generated: true,
    });
  }

  // Plan B: "{city} family events" — 1 spot + next 2 events. Only when the
  // city actually has multiple upcoming events to avoid a 1-event rail item.
  if (cityEvents.length >= 2 && citySpots.length >= 1) {
    const event_picks = pickNextEvents(cityEvents, 2);
    const spot_pick = pickTopSpots(citySpots, 1);
    const items = [...spot_pick, ...event_picks];
    const center = centroid(items);
    const summary = `Two upcoming family events in ${city} plus a nearby stop — ${event_picks
      .map((e) => e.title.slice(0, 60))
      .join(" · ")}.`;
    generated.push({
      id: `gen-events-${slug}`,
      name: `${city} family events`,
      summary: summary.slice(0, 240),
      accent: "festival",
      stopIds: spot_pick.map((s) => s.id),
      eventIds: event_picks.map((e) => e.id),
      audiences: ["all"],
      city,
      lat: center?.lat ?? null,
      lon: center?.lon ?? null,
      generated: true,
    });
  }
}

const finalPlans = [...handCurated, ...generated];

const out = {
  schemaVersion: 2,
  note:
    "Editor-curated starter plans + auto-generated per-city plans. Hand-written plans (no generated:true) are kept across runs; generated entries are rebuilt by scripts/generate-featured-plans.mjs each ingest. Each entry carries lat/lon + city so the frontend can show plans near the user's map view.",
  plans: finalPlans,
};

fs.writeFileSync(PLANS_PATH, JSON.stringify(out, null, 2) + "\n");
console.log(
  `[featured-plans] kept ${handCurated.length} hand-curated, generated ${generated.length} from ${cities.length} cities → ${finalPlans.length} total`,
);
