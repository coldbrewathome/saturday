#!/usr/bin/env node
// Generalized merge helper for non-Bay-Area metros. Takes adversarially-verified
// discovered events from /tmp/metro-discovered-<metro>.json (the `events` array
// returned by the iconic-metro July 4th discovery workflow) and merges them into
// the metro's manual-events file after category mapping, coverage/bbox/date
// validation, dedupe (against the generated feed + existing manual entries), and
// timezone-correct ISO stamping.
//
// Usage: node scripts/merge-metro-events.mjs --metro=new-york-city [--write]
// Without --write it does a dry run and prints what it WOULD add/skip.

import fs from "node:fs";
import { loadMetroConfig } from "./metroConfig.mjs";

const WRITE = process.argv.includes("--write");
const metroArg = (process.argv.find((a) => a.startsWith("--metro=")) || "").split("=")[1];
if (!metroArg) {
  console.error("Pass --metro=<id>, e.g. --metro=new-york-city");
  process.exit(1);
}

const metroConfig = loadMetroConfig();
const metro = metroConfig.metros.find((m) => m.id === metroArg);
if (!metro) {
  console.error(`Unknown metro '${metroArg}'.`);
  process.exit(1);
}
const manualPath = metro.manualEvents;
if (!manualPath) {
  console.error(`Metro '${metroArg}' has no manualEvents file configured.`);
  process.exit(1);
}

const dataDir = metro.dataDir || metro.id;
const DISCOVERED = process.env.DISCOVERED || `/tmp/metro-discovered-${metroArg}.json`;
const FEED = `public/data/${dataDir}/events.json`;
const SOURCES = `data/event-sources-${metroArg}.json`;
const TARGET_DATES = new Set(
  (process.env.TARGET_DATES || "2026-06-27,2026-06-28,2026-07-03,2026-07-04,2026-07-05")
    .split(",").map((s) => s.trim()).filter(Boolean),
);

const CATEGORY_MAP = { Fair: "Festival", Aquarium: "Museum", Garden: "Park", Tour: "Culture" };
const VALID_AGE = new Set(["toddler", "preschool", "school-age", "tween"]);
const VALID_AUD = new Set(["kids", "adults", "all"]);
const AGE_ALIAS = {
  toddler: ["toddler"], baby: ["toddler"], infant: ["toddler"],
  preschool: ["preschool"], preschooler: ["preschool"],
  "school-age": ["school-age"], "school age": ["school-age"], kid: ["school-age"], kids: ["preschool", "school-age"], child: ["school-age"], children: ["preschool", "school-age"],
  tween: ["tween"], tweens: ["tween"], teen: ["tween"], teens: ["tween"], "all-ages": ["toddler", "preschool", "school-age", "tween"], "all ages": ["toddler", "preschool", "school-age", "tween"], family: ["preschool", "school-age", "tween"], families: ["preschool", "school-age", "tween"],
};
function normalizeAges(raw) {
  const out = new Set();
  for (const a of raw || []) {
    const key = String(a).toLowerCase().trim();
    if (VALID_AGE.has(key)) { out.add(key); continue; }
    for (const b of AGE_ALIAS[key] || []) out.add(b);
  }
  return [...out];
}
function normalizeAudiences(raw) {
  const out = new Set();
  for (const a of raw || []) {
    const key = String(a).toLowerCase().trim();
    if (VALID_AUD.has(key)) { out.add(key); continue; }
    if (/famil|kid|child|youth/.test(key)) out.add("kids");
    else if (/adult|21\+|grown/.test(key)) out.add("adults");
    else if (/general|all|everyone|public/.test(key)) out.add("all");
  }
  return [...out];
}
function slugify(s) {
  return String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}
function timeWindowFrom(hhmm) {
  const h = Number(String(hhmm || "").split(":")[0]);
  if (!Number.isFinite(h)) return "Afternoon";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}
function dowFor(dateStr, offset) {
  const d = new Date(`${dateStr}T12:00:00${offset}`);
  return d.getUTCDay();
}
// Timezone-correct offset string (handles DST + Honolulu) for the event date.
function tzOffset(timeZone, dateStr) {
  const d = new Date(`${dateStr}T12:00:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
    .formatToParts(d).find((p) => p.type === "timeZoneName")?.value || "GMT+00:00";
  const m = name.match(/GMT([+-]\d{2}):?(\d{2})/);
  return m ? `${m[1]}:${m[2]}` : "+00:00";
}

function readJson(p, fallback) {
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return fallback; }
}

const discovered = readJson(DISCOVERED, { events: [] });
const discEvents = Array.isArray(discovered) ? discovered : discovered.events || [];
const manualDoc = readJson(manualPath, { schemaVersion: 1, events: [] });
if (!Array.isArray(manualDoc.events)) manualDoc.events = [];
const feed = readJson(FEED, { events: [] });
const sources = readJson(SOURCES, { coverage: { cities: [] } });
const coverageCities = new Set((sources.coverage?.cities || []).map((c) => c.toLowerCase()));
const bbox = metro.spotCoverage?.bbox || null;
const timeZone = metro.timezone || "America/New_York";

// City centroid lookup from the feed so a candidate with a known coverage city
// but missing/garbled coords still lands in-bbox instead of being dropped.
const cityCentroids = new Map();
for (const e of feed.events || []) {
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
  const key = (e.city || "").toLowerCase().trim();
  if (!key) continue;
  const agg = cityCentroids.get(key) || { lat: 0, lon: 0, n: 0 };
  agg.lat += e.lat; agg.lon += e.lon; agg.n += 1;
  cityCentroids.set(key, agg);
}
function centroidFor(city) {
  const agg = cityCentroids.get((city || "").toLowerCase().trim());
  if (!agg || !agg.n) return null;
  return { lat: agg.lat / agg.n, lon: agg.lon / agg.n };
}

function evKey(title, venue, dateStr) {
  return `${slugify(title)}|${slugify(venue)}|${dateStr}`;
}
const existingKeys = new Set();
const existingTitleVenue = new Set();
for (const e of feed.events || []) {
  const dt = (e.startDateTime || "").slice(0, 10);
  if (TARGET_DATES.has(dt)) {
    existingKeys.add(evKey(e.title, e.venue, dt));
    existingTitleVenue.add(`${slugify(e.title)}|${slugify(e.venue)}`);
  }
}
for (const e of manualDoc.events) {
  const dt = (e.startDateTime || "").slice(0, 10);
  existingKeys.add(evKey(e.title, e.venue, dt));
  existingTitleVenue.add(`${slugify(e.title)}|${slugify(e.venue)}`);
}
const existingIds = new Set(manualDoc.events.map((e) => e.id));

function cityOk(city, lat, lon) {
  if (city && coverageCities.has(city.toLowerCase())) return true;
  if (!bbox) return false;
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east
  );
}

const added = [];
const skipped = [];
const seenThisRun = new Set();

for (const e of discEvents) {
  const date = e.date;
  if (!TARGET_DATES.has(date)) { skipped.push([e.title, `bad date ${date}`]); continue; }
  let lat = e.lat, lon = e.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    const c = centroidFor(e.city);
    if (c) { lat = c.lat; lon = c.lon; }
    else { skipped.push([e.title, "missing/invalid coords (no city centroid)"]); continue; }
  }
  if (!cityOk(e.city, lat, lon)) { skipped.push([e.title, `city '${e.city}' outside coverage & bbox`]); continue; }
  const key = evKey(e.title, e.venue, date);
  const tv = `${slugify(e.title)}|${slugify(e.venue)}`;
  if (existingKeys.has(key) || existingTitleVenue.has(tv) || seenThisRun.has(key)) {
    skipped.push([e.title, "duplicate of existing/feed/run"]); continue;
  }
  seenThisRun.add(key);

  const offset = tzOffset(timeZone, date);
  const category = CATEGORY_MAP[e.category] || e.category || "Community";
  const ageBands = normalizeAges(e.ageBands);
  let audiences = normalizeAudiences(e.audiences);
  if (audiences.length === 0) audiences = ["all"];
  const startTime = /^\d{1,2}:\d{2}$/.test(e.startTime || "") ? e.startTime : "10:00";
  const endTime = /^\d{1,2}:\d{2}$/.test(e.endTime || "") ? e.endTime : null;
  let id = `${slugify(e.title)}-${date}`.slice(0, 80);
  if (existingIds.has(id) || added.some((a) => a.id === id)) id = `${slugify(e.title)}-${slugify(e.venue).slice(0, 12)}-${date}`;

  added.push({
    id,
    title: e.title,
    description: e.description || "",
    venue: e.venue,
    city: e.city,
    neighborhood: e.neighborhood || e.city,
    lat,
    lon,
    category,
    daysOfWeek: [dowFor(date, offset)],
    timeWindow: timeWindowFrom(startTime),
    startDateTime: `${date}T${startTime.padStart(5, "0")}:00.000${offset}`,
    endDateTime: endTime ? `${date}T${endTime.padStart(5, "0")}:00.000${offset}` : `${date}T${startTime.padStart(5, "0")}:00.000${offset}`,
    ageBands: ageBands.length ? ageBands : ["preschool", "school-age", "tween"],
    audiences,
    cost: e.cost || "Unknown",
    url: e.url,
    verified: true,
  });
}

console.log(`[${metroArg}] Discovered input: ${discEvents.length}`);
console.log(`[${metroArg}] Would ADD: ${added.length}  Skipped: ${skipped.length}`);
for (const [t, why] of skipped) console.log(`  - skip: ${t} :: ${why}`);
console.log("=== ADD preview (title | date | venue | city | category | cost) ===");
for (const a of added) console.log(`  + ${a.title} | ${a.startDateTime.slice(0, 10)} | ${a.venue} | ${a.city} | ${a.category} | ${a.cost}`);

if (WRITE) {
  manualDoc.events.push(...added);
  fs.writeFileSync(manualPath, JSON.stringify(manualDoc, null, 2) + "\n");
  console.log(`\n[${metroArg}] WROTE ${added.length} events to ${manualPath} (now ${manualDoc.events.length} total).`);
} else {
  console.log("\n(dry run — pass --write to apply)");
}
