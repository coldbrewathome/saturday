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

// Holiday weekends get their own themed plans on top of the regular city
// plans. The themed plan groups events that fall in the holiday window AND
// match a holiday-specific keyword/source pattern, then anchors them with a
// nearby spot. Reusable for future holidays — add another entry below.
const HOLIDAY_WEEKENDS = [
  {
    id: "memorial-day-2026",
    name: "Memorial Day Weekend",
    short: "Memorial Day",
    start: "2026-05-23T00:00:00-08:00",
    end: "2026-05-26T00:00:00-08:00",
    re: /\b(memorial|fleet\s*week|carnaval|flag\s*garden|fort\s*rosecrans|uss\s*midway|uss\s*pampanito|hillsborough|rohnert|foodieland|brooklyn.{0,40}parade|intrepid|danceafrica|arlington|rolling\s*to\s*remember|seaport.{0,40}parade|dorchester.{0,40}parade|canoga|national\s*memorial|veteran)\b/i,
    accent: "festival",
  },
];

function eventMatchesHoliday(event, holiday) {
  if (!event.startDateTime) return false;
  const t = Date.parse(event.startDateTime);
  if (!Number.isFinite(t)) return false;
  if (t < Date.parse(holiday.start) || t >= Date.parse(holiday.end)) return false;
  const title = event.title || "";
  // Drop closure announcements ("Library closed for Memorial Day"). Match only
  // against the title — venue/description matching pulls in events whose only
  // connection is a venue named "Martin Luther King Jr. Memorial Library".
  if (/\b(closed|closure|cancel{1,2}ed)\b/i.test(title)) return false;
  return holiday.re.test(title);
}

function holidayDedupeKey(event) {
  const base = (event.title || "")
    .split(/[—:|·]/)[0]
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  return base || event.id;
}

function buildHolidayWeekendPlans(spots, events, audienceTag) {
  const generated = [];
  const spotsByCity = groupSpotsByCity(spots);
  for (const holiday of HOLIDAY_WEEKENDS) {
    const matched = events.filter((e) => eventMatchesHoliday(e, holiday));
    if (matched.length === 0) continue;
    const byCity = new Map();
    for (const e of matched) {
      const city = normalizeCity(e.city) || normalizeCity(e.neighborhood);
      if (!city) continue;
      if (!byCity.has(city)) byCity.set(city, []);
      byCity.get(city).push(e);
    }
    for (const [city, cityEvents] of byCity) {
      cityEvents.sort(
        (a, b) => Date.parse(a.startDateTime) - Date.parse(b.startDateTime),
      );
      const seenIds = new Set();
      const seenTitleKeys = new Set();
      const eventPicks = [];
      for (const e of cityEvents) {
        if (seenIds.has(e.id)) continue;
        const titleKey = holidayDedupeKey(e);
        if (seenTitleKeys.has(titleKey)) continue;
        seenIds.add(e.id);
        seenTitleKeys.add(titleKey);
        eventPicks.push(e);
        if (eventPicks.length >= 3) break;
      }
      const citySpots = spotsByCity.get(city) || [];
      const cityAnchorSpots = citySpots.filter(isPlanAnchorSpot);
      const spotPick =
        cityAnchorSpots.length > 0 ? pickTopSpots(cityAnchorSpots, 1) : [];
      const items = [...spotPick, ...eventPicks];
      if (items.length < 2) continue;
      const center = centroid(items);
      const titles = eventPicks.map((e) =>
        (e.title || "").split(/[—•·|]/)[0].trim().slice(0, 60),
      );
      const summary = `${holiday.name} in ${city} — ${titles.join(" · ")}.`;
      const slug = slugCity(city);
      generated.push({
        id: `gen-holiday-${holiday.id}-${slug}`,
        name: `${holiday.short} in ${city}`,
        summary: summary.slice(0, 240),
        accent: holiday.accent,
        stopIds: spotPick.map((s) => s.id),
        eventIds: eventPicks.map((e) => e.id),
        audiences: [audienceTag],
        city,
        lat: center?.lat ?? null,
        lon: center?.lon ?? null,
        generated: true,
        themed: holiday.id,
      });
    }
  }
  return generated;
}

function buildKidsPlans(spots, events) {
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
      const picks = pickTopSpots(cityAnchorSpots, Math.min(3, cityAnchorSpots.length));
      const center = centroid(picks);
      const summary = `${picks.length} stops in ${city} - ${picks.map((p) => p.name.split(",")[0]).join(", ")}.`;
      generated.push({
        id: `gen-day-${slug}`,
        name: `Day out in ${city}`,
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

    if (cityEvents.length >= 2 && cityAnchorSpots.length >= 1) {
      const eventPicks = pickNextEvents(cityEvents, 2);
      const spotPick = pickTopSpots(cityAnchorSpots, 1);
      const items = [...spotPick, ...eventPicks];
      const center = centroid(items);
      const summary = `Two upcoming events in ${city} plus a nearby stop - ${eventPicks.map((e) => e.title.slice(0, 60)).join(" | ")}.`;
      generated.push({
        id: `gen-events-${slug}`,
        name: `${city} events`,
        summary: summary.slice(0, 240),
        accent: "festival",
        stopIds: spotPick.map((s) => s.id),
        eventIds: eventPicks.map((e) => e.id),
        audiences: ["all"],
        city,
        lat: center?.lat ?? null,
        lon: center?.lon ?? null,
        generated: true,
      });
    }
  }
  return { generated, cityCount: cities.length };
}

const NIGHTLIFE_CATS = new Set(["Nightlife"]);
const GOING_OUT_CATS = new Set(["Nightlife", "Food"]);
const DAYTIME_CATS = new Set(["Outdoors", "Culture", "Wellness"]);

function adultsPlanName(picks) {
  const cats = picks.map((p) => p.category);
  const hasNightlife = cats.some((c) => NIGHTLIFE_CATS.has(c));
  const hasFood = cats.some((c) => c === "Food");
  const hasCulture = cats.some((c) => c === "Culture");
  const hasOutdoors = cats.some((c) => c === "Outdoors");
  const hasWellness = cats.some((c) => c === "Wellness");

  if (hasNightlife && hasFood) return "Dinner & drinks";
  if (hasNightlife) return "Night out";
  if (hasFood && hasCulture) return "Bites & culture";
  if (hasFood) return "Food crawl";
  if (hasCulture) return "Culture hop";
  if (hasOutdoors && hasFood) return "Day out";
  if (hasOutdoors) return "Outdoor day";
  if (hasWellness) return "Active day";
  return "Day out";
}

function adultsPlanAccent(picks) {
  for (const spot of picks) {
    if (spot.category === "Nightlife") return "festival";
    if (spot.category === "Food") return "food";
    if (spot.category === "Culture") return "festival";
  }
  return "park";
}

function buildAdultsPlans(spots, events) {
  const spotsByCity = groupSpotsByCity(spots);
  const eventsByCity = groupUpcomingEventsByCity(events);
  const generated = [];
  const cities = Array.from(
    new Set([...spotsByCity.keys(), ...eventsByCity.keys()]),
  ).sort();

  for (const city of cities) {
    const citySpots = spotsByCity.get(city) || [];
    const cityEvents = eventsByCity.get(city) || [];
    if (citySpots.length < 2 && cityEvents.length === 0) continue;
    const slug = slugCity(city);

    const nightlifeSpots = citySpots.filter((s) => NIGHTLIFE_CATS.has(s.category));
    const goingOutSpots = citySpots.filter((s) => GOING_OUT_CATS.has(s.category));
    const nonNightlife = citySpots.filter((s) => !NIGHTLIFE_CATS.has(s.category));

    if (goingOutSpots.length >= 2) {
      const picks = pickTopSpots(goingOutSpots, Math.min(3, goingOutSpots.length));
      const center = centroid(picks);
      const name = adultsPlanName(picks);
      const summary = `${picks.length} stops in ${city} - ${picks.map((p) => p.name.split(",")[0]).join(", ")}.`;
      generated.push({
        id: `gen-night-${slug}`,
        name: `${name} in ${city}`,
        summary: summary.slice(0, 220),
        accent: adultsPlanAccent(picks),
        stopIds: picks.map((p) => p.id),
        eventIds: [],
        audiences: ["adults"],
        city,
        lat: center?.lat ?? null,
        lon: center?.lon ?? null,
        generated: true,
      });
    }

    if (nonNightlife.length >= 2) {
      const picks = pickTopSpots(nonNightlife, Math.min(3, nonNightlife.length));
      const center = centroid(picks);
      const name = adultsPlanName(picks);
      if (name !== (generated[generated.length - 1]?.name?.replace(` in ${city}`, "") || "")) {
        const summary = `${picks.length} stops in ${city} - ${picks.map((p) => p.name.split(",")[0]).join(", ")}.`;
        generated.push({
          id: `gen-day-${slug}`,
          name: `${name} in ${city}`,
          summary: summary.slice(0, 220),
          accent: adultsPlanAccent(picks),
          stopIds: picks.map((p) => p.id),
          eventIds: [],
          audiences: ["adults"],
          city,
          lat: center?.lat ?? null,
          lon: center?.lon ?? null,
          generated: true,
        });
      }
    }

    if (cityEvents.length >= 2 && citySpots.length >= 1) {
      const eventPicks = pickNextEvents(cityEvents, 2);
      const spotPick = pickTopSpots(nightlifeSpots.length > 0 ? nightlifeSpots : goingOutSpots.length > 0 ? goingOutSpots : citySpots, 1);
      const items = [...spotPick, ...eventPicks];
      const center = centroid(items);
      const summary = `Upcoming in ${city} - ${eventPicks.map((e) => e.title.slice(0, 60)).join(" | ")}.`;
      generated.push({
        id: `gen-events-${slug}`,
        name: `${city} tonight`,
        summary: summary.slice(0, 240),
        accent: "festival",
        stopIds: spotPick.map((s) => s.id),
        eventIds: eventPicks.map((e) => e.id),
        audiences: ["adults"],
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

  const kids = buildKidsPlans(kidsSpots, kidsEvents);
  const kidsHoliday = buildHolidayWeekendPlans(kidsSpots, kidsEvents, "all");
  const kidsFinal = [...handCurated, ...kidsHoliday, ...kids.generated];
  const kidsOut = {
    schemaVersion: 2,
    metroId: metro.id,
    note: "Auto-generated per-city plans for kids audience.",
    plans: kidsFinal,
  };
  writeJsonWithLegacy(metro, "featuredPlans", kidsOut);
  console.log(
    `[featured-plans:${metro.id}] kept ${handCurated.length} hand-curated, generated ${kids.generated.length} from ${kids.cityCount} cities, holiday ${kidsHoliday.length} -> ${kidsFinal.length} total`,
  );

  const adultsSpotPath = path.join(ROOT, metroDataFile(metro, "spots")).replace(/spots\.json$/, "spots-adults.json");
  const adultsEventPath = path.join(ROOT, metroDataFile(metro, "events")).replace(/events\.json$/, "events-adults.json");
  const adultsSpotsDoc = readJsonOrEmpty(adultsSpotPath, { spots: [] });
  const adultsEventsDoc = readJsonOrEmpty(adultsEventPath, { events: [] });
  const adultsSpots = Array.isArray(adultsSpotsDoc.spots) ? adultsSpotsDoc.spots : [];
  const adultsEvents = Array.isArray(adultsEventsDoc.events) ? adultsEventsDoc.events : [];

  const adults = buildAdultsPlans(adultsSpots, adultsEvents);
  const adultsHoliday = buildHolidayWeekendPlans(adultsSpots, adultsEvents, "adults");
  const adultsOut = {
    schemaVersion: 2,
    metroId: metro.id,
    note: "Auto-generated per-city plans for adults audience.",
    plans: [...adultsHoliday, ...adults.generated],
  };
  const adultsOutPath = path.join(ROOT, metroDataFile(metro, "featuredPlans")).replace(/featured-plans\.json$/, "featured-plans-adults.json");
  fs.mkdirSync(path.dirname(adultsOutPath), { recursive: true });
  fs.writeFileSync(adultsOutPath, JSON.stringify(adultsOut, null, 2) + "\n");
  console.log(
    `[featured-plans-adults:${metro.id}] generated ${adults.generated.length} from ${adults.cityCount} cities, holiday ${adultsHoliday.length}`,
  );
}

for (const metro of selection.all ? metroConfig.metros : [selection.metro]) {
  generateForMetro(metro);
}
