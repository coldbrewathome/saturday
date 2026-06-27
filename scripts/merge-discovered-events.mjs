#!/usr/bin/env node
// One-off merge helper: takes adversarially-verified discovered events
// (/tmp/discovered-events.json, the `events` array returned by the
// discover-next-weekend workflow) and merges them into data/manual-events.json
// after category mapping, coverage/city validation, and dedupe against both the
// generated feed and existing manual entries.
//
// Usage: node scripts/merge-discovered-events.mjs [--write]
// Without --write it does a dry run and prints what it WOULD add/skip.

import fs from "node:fs";

const WRITE = process.argv.includes("--write");
const DISCOVERED = "/tmp/discovered-events.json";
const MANUAL = "data/manual-events.json";
const FEED = "public/data/bay-area/events.json";
const SOURCES = "data/event-sources.json";

const CATEGORY_MAP = { Fair: "Festival", Aquarium: "Museum", Garden: "Park", Tour: "Culture" };
const VALID_AGE = new Set(["toddler", "preschool", "school-age", "tween"]);
const VALID_AUD = new Set(["kids", "adults", "all"]);
// Agents emit loose age labels; normalize to the canonical bands.
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
// audiences: families/general/kids/soccer fans -> kids/adults/all
function normalizeAudiences(raw) {
  const out = new Set();
  for (const a of raw || []) {
    const key = String(a).toLowerCase().trim();
    if (VALID_AUD.has(key)) { out.add(key); continue; }
    if (/famil|kid|child|youth|soccer fan/.test(key)) out.add("kids");
    else if (/adult|21\+|grown/.test(key)) out.add("adults");
    else if (/general|all|everyone|public/.test(key)) out.add("all");
  }
  return [...out];
}

function slugify(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function timeWindowFrom(hhmm) {
  const h = Number(String(hhmm || "").split(":")[0]);
  if (!Number.isFinite(h)) return "Afternoon";
  if (h < 12) return "Morning";
  if (h < 17) return "Afternoon";
  return "Evening";
}

function dowFor(dateStr) {
  // dateStr YYYY-MM-DD, interpret as Pacific local day -> getUTCDay on noon-local
  const d = new Date(`${dateStr}T12:00:00-07:00`);
  return d.getUTCDay();
}

const discovered = JSON.parse(fs.readFileSync(DISCOVERED, "utf8"));
const discEvents = Array.isArray(discovered) ? discovered : discovered.events || [];
const manualDoc = JSON.parse(fs.readFileSync(MANUAL, "utf8"));
const feed = JSON.parse(fs.readFileSync(FEED, "utf8"));
const sources = JSON.parse(fs.readFileSync(SOURCES, "utf8"));
const coverageCities = new Set((sources.coverage?.cities || []).map((c) => c.toLowerCase()));
const bbox = { south: 36.45, west: -123.05, north: 38.95, east: -121.15 };
// Target weekends: this weekend (Jun 27-28) + July 4th weekend (Jul 3-5).
// Override with TARGET_DATES env (comma-separated YYYY-MM-DD) if needed.
const TARGET_DATES = new Set(
  (process.env.TARGET_DATES || "2026-06-27,2026-06-28,2026-07-03,2026-07-04,2026-07-05")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean),
);

// City centroid lookup from the feed, so a candidate with a known coverage city
// but missing/garbled coords still lands in-bbox instead of being dropped.
const cityCentroids = new Map();
for (const e of feed.events) {
  if (!Number.isFinite(e.lat) || !Number.isFinite(e.lon)) continue;
  const key = (e.city || "").toLowerCase().trim();
  if (!key) continue;
  const agg = cityCentroids.get(key) || { lat: 0, lon: 0, n: 0 };
  agg.lat += e.lat;
  agg.lon += e.lon;
  agg.n += 1;
  cityCentroids.set(key, agg);
}
function centroidFor(city) {
  const agg = cityCentroids.get((city || "").toLowerCase().trim());
  if (!agg || !agg.n) return null;
  return { lat: agg.lat / agg.n, lon: agg.lon / agg.n };
}

// Dedupe keys from existing feed (target weekends) + existing manual events
function evKey(title, venue, dateStr) {
  return `${slugify(title)}|${slugify(venue)}|${dateStr}`;
}
const existingKeys = new Set();
const existingTitleVenue = new Set(); // looser: title|venue (any date this window)
for (const e of feed.events) {
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

const added = [];
const skipped = [];
const seenThisRun = new Set();

function cityOk(city, lat, lon) {
  if (city && coverageCities.has(city.toLowerCase())) return true;
  return (
    Number.isFinite(lat) && Number.isFinite(lon) &&
    lat >= bbox.south && lat <= bbox.north && lon >= bbox.west && lon <= bbox.east
  );
}

for (const e of discEvents) {
  const date = e.date;
  if (!TARGET_DATES.has(date)) {
    skipped.push([e.title, `bad date ${date}`]);
    continue;
  }
  let lat = e.lat;
  let lon = e.lon;
  if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) {
    const c = centroidFor(e.city);
    if (c) {
      lat = c.lat;
      lon = c.lon;
    } else {
      skipped.push([e.title, "missing/invalid coords (no city centroid)"]);
      continue;
    }
  }
  if (!cityOk(e.city, lat, lon)) {
    skipped.push([e.title, `city '${e.city}' outside coverage & bbox`]);
    continue;
  }
  const key = evKey(e.title, e.venue, date);
  const tv = `${slugify(e.title)}|${slugify(e.venue)}`;
  if (existingKeys.has(key) || existingTitleVenue.has(tv) || seenThisRun.has(key)) {
    skipped.push([e.title, "duplicate of existing/feed/run"]);
    continue;
  }
  seenThisRun.add(key);

  const category = CATEGORY_MAP[e.category] || e.category || "Community";
  const ageBands = normalizeAges(e.ageBands);
  let audiences = normalizeAudiences(e.audiences);
  if (audiences.length === 0) audiences = ["all"];
  const startTime = /^\d{1,2}:\d{2}$/.test(e.startTime || "") ? e.startTime : "10:00";
  const endTime = /^\d{1,2}:\d{2}$/.test(e.endTime || "") ? e.endTime : null;
  let id = `${slugify(e.title)}-${date}`.slice(0, 80);
  if (existingIds.has(id) || added.some((a) => a.id === id)) id = `${slugify(e.title)}-${slugify(e.venue).slice(0, 12)}-${date}`;

  const obj = {
    id,
    title: e.title,
    description: e.description || "",
    venue: e.venue,
    city: e.city,
    neighborhood: e.neighborhood || e.city,
    lat,
    lon,
    category,
    daysOfWeek: [dowFor(date)],
    timeWindow: timeWindowFrom(startTime),
    startDateTime: `${date}T${startTime.padStart(5, "0")}:00.000-07:00`,
    endDateTime: endTime ? `${date}T${endTime.padStart(5, "0")}:00.000-07:00` : `${date}T${startTime.padStart(5, "0")}:00.000-07:00`,
    ageBands: ageBands.length ? ageBands : ["preschool", "school-age"],
    audiences,
    cost: e.cost || "Unknown",
    url: e.url,
    verified: true,
  };
  added.push(obj);
}

console.log(`Discovered input: ${discEvents.length}`);
console.log(`Would ADD: ${added.length}`);
console.log(`Skipped: ${skipped.length}`);
for (const [t, why] of skipped) console.log(`  - skip: ${t} :: ${why}`);
console.log("");
console.log("=== ADD preview (title | date | venue | city | category | cost) ===");
for (const a of added) {
  console.log(`  + ${a.title} | ${a.startDateTime.slice(0, 10)} | ${a.venue} | ${a.city} | ${a.category} | ${a.cost}`);
}

if (WRITE) {
  manualDoc.events.push(...added);
  fs.writeFileSync(MANUAL, JSON.stringify(manualDoc, null, 2) + "\n");
  console.log(`\nWROTE ${added.length} events to ${MANUAL} (now ${manualDoc.events.length} total).`);
} else {
  console.log("\n(dry run — pass --write to apply)");
}
