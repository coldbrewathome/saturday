#!/usr/bin/env node
// Pick the 6 strongest kid-friendly events for the coming weekend, per metro.
//
// Reads public/data/<metro>/events.json and writes videos/weekend-picks.json.
// The weekend window is computed in each metro's own timezone, so "Saturday"
// means Saturday there.
//
//   node videos/pick-weekend-events.mjs [--weekend 2026-08-01]

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

const argAt = process.argv.indexOf("--weekend");
const SAT = argAt > -1 ? process.argv[argAt + 1] : "2026-08-01";

export const METROS = [
  { id: "bay-area", name: "Bay Area", tz: "America/Los_Angeles", at: [37.7749, -122.4194] },
  { id: "los-angeles", name: "Los Angeles", tz: "America/Los_Angeles", at: [34.0522, -118.2437] },
  { id: "san-diego", name: "San Diego", tz: "America/Los_Angeles", at: [32.7157, -117.1611] },
  { id: "seattle", name: "Seattle", tz: "America/Los_Angeles", at: [47.6062, -122.3321] },
  { id: "phoenix", name: "Phoenix", tz: "America/Phoenix", at: [33.4484, -112.074] },
  { id: "chicago", name: "Chicago", tz: "America/Chicago", at: [41.8781, -87.6298] },
  { id: "houston", name: "Houston", tz: "America/Chicago", at: [29.7604, -95.3698] },
  { id: "dallas-fort-worth", name: "Dallas–Fort Worth", tz: "America/Chicago", at: [32.7767, -96.797] },
  { id: "austin", name: "Austin", tz: "America/Chicago", at: [30.2672, -97.7431] },
  { id: "new-york-city", name: "New York City", tz: "America/New_York", at: [40.7128, -74.006] },
  { id: "washington-dc", name: "Washington DC", tz: "America/New_York", at: [38.9072, -77.0369] },
  { id: "philadelphia", name: "Philadelphia", tz: "America/New_York", at: [39.9526, -75.1652] },
  { id: "boston", name: "Boston", tz: "America/New_York", at: [42.3601, -71.0589] },
  { id: "atlanta", name: "Atlanta", tz: "America/New_York", at: [33.749, -84.388] },
  { id: "miami", name: "Miami", tz: "America/New_York", at: [25.7617, -80.1918] },
  { id: "honolulu", name: "Honolulu", tz: "Pacific/Honolulu", at: [21.3069, -157.8583] },
];

// Several feeds are statewide (the Hawaii library system covers Hilo and Maui;
// one Miami record carries a Montana address). A card that names a city 200
// miles away is wrong even though the record is real.
const MAX_MILES = 75;
// scripts/eventPipeline.mjs falls back to San Francisco when its city-centroid
// lookup misses, so 53 events across 11 metros carry SF's coordinates. Treat
// that exact pair as "no coordinate" rather than geofencing Boston out of Boston.
const SF_FALLBACK = (lat, lon) => lat === 37.7749 && lon === -122.4194;
const milesFrom = ([alat, alon], lat, lon) => {
  if (typeof lat !== "number" || typeof lon !== "number") return null;
  if (SF_FALLBACK(lat, lon)) return null;
  const R = 3958.8, rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat - alat), dLon = rad(lon - alon);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(alat)) * Math.cos(rad(lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};

// A listing can be free, priced, or simply not say. Never upgrade "not said"
// into "free" - the whole pitch of these cuts is that the numbers are real.
const COST = (raw) => {
  const c = (raw || "").trim();
  if (/^free/i.test(c) && !/register/i.test(c)) return { label: "Free", free: true };
  if (/^free/i.test(c)) return { label: "Free · RSVP", free: true };
  if (/included with admission/i.test(c)) return { label: "With admission", free: false };
  if (/^\$/.test(c)) return { label: "Ticketed", free: false };
  return { label: "Check listing", free: false };
};

const CAT_WEIGHT = {
  Festival: 62, "Live Music": 56, Market: 50, Community: 46, Zoo: 46, Museum: 42,
  Theater: 40, Culture: 36, Park: 32, Outdoors: 32, Sports: 26, Library: -25,
};

// Real listings that are not "something to do with the kids this weekend".
const NOT_AN_OUTING = [
  /blood drive|vaccinat|flu shot|blood donor|donation drive/i,
  /job fair|career fair|r[eé]sum[eé]|tax (help|prep)|legal clinic|genealogy|notary/i,
  /food (distribution|pantry)|summer meals|meal (program|site)|free lunch/i,
  /\bmembers? (only|event|morning|coffee|preview|night)\b|^member /i,
  /sound healing|\bmeditation\b|wine|brewery|happy hour|21\+|adults only/i,
  /\bsupport group\b|grief|caregiver|blood pressure|health screening|headshot|passport photo/i,
  /\b(gmail|google docs|microsoft|excel|word processing|computer (basics|class|lab)|internet basics|esl|citizenship|medicare|social security|job search)\b/i,
];
// Titles that carry no information on screen ("10 a.m. – 5 p.m.", "TBD").
const UNUSABLE = /^[\d\s:.–—-]*(a\.?m\.?|p\.?m\.?)[\s\S]*$|^tbd$|^tba$|^event$|^program$/i;
// Generic recurring programming: fine to attend, weak on screen.
const GENERIC = /^(baby|toddler|family|preschool|bilingual|kids?)?\s*(story ?time|story hour)$|^baby (play|band|time|party!?)$|^chess (club|academy)|^lego®? (club|challenge)$|^open play$|^drop[- ]in|^art cart$|^game day$|^mind games$|^pingo!?$|^babytime$|^build it!?$|^craft (time|corner)$|^music & movement$|^kids cafe$|^pok[eé]mon club$|^creative corner$|^silly science$/i;
// Legitimate, but a work party is a weak lead card for "things to do".
const CHORE = /it'?s my park|clean ?-?up|restoration workday|weeding|spruce up|volunteer/i;

const dayKey = (iso, tz) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
const dayName = (iso, tz) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(iso));
// A midnight local start is an all-day marker in these feeds, not a listing
// that actually begins at 12am. Same for any pre-6am start — those are
// UTC-stamped local times from sources without a timezone (Fairplex), and no
// real kids listing starts at 3am. Say "All day" rather than print a wrong time.
const clock = (iso, tz) => {
  const t = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" })
    .format(new Date(iso)).toLowerCase().replace(/\s/g, " ");
  const h = Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false })
    .format(new Date(iso)));
  return h < 6 ? "All day" : t;
};

const sunOf = (sat) => {
  const d = new Date(sat + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const weekOf = (sat) => {
  // The Mon-Sun week the weekend closes out.
  const out = [];
  const d = new Date(sat + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() - 5);
  for (let i = 0; i < 7; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
};

const SCORE_FLOOR = 60;
const SUN = sunOf(SAT);
const WEEK = weekOf(SAT);
// Feeds emit one record per day with the weekday in parentheses; strip any
// weekday so "…Fair (Friday)" and "…Fair (Saturday)" collapse to one event.
const baseTitle = (t) =>
  t.replace(/\s*\((mon|tues?|wed(nes)?|thurs?|fri|satur?|sun)(day)?\)\s*/i, " ").replace(/\s+/g, " ").trim();

// A venue string that is just a borough or repeats the city ("Manhattan,
// Manhattan") means the feed lost the real location - a card cannot carry it.
const BOROUGHS = /^(manhattan|brooklyn|queens|bronx|staten island)$/i;
const US_STATE = /,\s*(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming)\b/i;
const venueIsUseless = (venue, city) =>
  !venue ||
  BOROUGHS.test(venue.trim()) ||
  venue.trim().toLowerCase() === (city || "").trim().toLowerCase() ||
  US_STATE.test(venue);
// A city field carrying a state name is out-of-metro junk ("Havre, Montana").
const cityIsBroken = (city) => US_STATE.test(city || "");

// The app's own age filter, verbatim from src/planner.ts (ageBandLabels).
const AGE_LABEL = {
  toddler: "Toddler (1-3)", preschool: "Preschool (3-5)",
  "school-age": "School age (6-10)", tween: "Tween (10-13)",
};
const AGE_RANGE = { toddler: [1, 3], preschool: [3, 5], "school-age": [6, 10], tween: [10, 13] };

// "Ages 6-13" from the record's own bands - real utility on the card, and it
// sets up the filter payoff at the end.
const ageSummary = (bands = []) => {
  const known = bands.filter((b) => AGE_RANGE[b]);
  if (!known.length) return "";
  const lo = Math.min(...known.map((b) => AGE_RANGE[b][0]));
  const hi = Math.max(...known.map((b) => AGE_RANGE[b][1]));
  return lo === hi ? `Ages ${lo}` : `Ages ${lo}–${hi}`;
};

const result = { weekend: { saturday: SAT, sunday: SUN }, week: WEEK, metros: [] };

for (const metro of METROS) {
  const all = JSON.parse(readFileSync(join(ROOT, "public/data", metro.id, "events.json"), "utf8")).events || [];

  const weekEvents = all.filter((e) => WEEK.includes(dayKey(e.startDateTime, metro.tz)));
  const weekFree = weekEvents.filter((e) => COST(e.cost).free);

  // A title that recurs dozens of times in the feed is a standing program, not
  // an event worth a card. Frequency of the title stem is a cheap, honest
  // proxy for "is this the thing this city is doing on Saturday".
  const stemCount = new Map();
  for (const e of all) {
    const stem = baseTitle(e.title).toLowerCase().slice(0, 14);
    stemCount.set(stem, (stemCount.get(stem) || 0) + 1);
  }

  const collect = (days) => {
    // Collapse the (Saturday)/(Sunday) pairs festivals emit into one entry
    // that owns both days.
    const byKey = new Map();
    for (const e of all) {
      const day = dayKey(e.startDateTime, metro.tz);
      if (!days.includes(day)) continue;
      if (!e.verified) continue;
      const title = baseTitle(e.title);
      if (!title || title.length < 5) continue;
      if (UNUSABLE.test(title)) continue;
      if (NOT_AN_OUTING.some((re) => re.test(title))) continue;
      // A card has to name a real place in this metro, or it is not a card.
      if (venueIsUseless(e.venue, e.city) || cityIsBroken(e.city)) continue;
      const miles = milesFrom(metro.at, e.lat, e.lon);
      if (miles !== null && miles > MAX_MILES) continue;
      const key = title.toLowerCase() + "|" + (e.venue || "").toLowerCase();
      const prev = byKey.get(key);
      if (prev) {
        prev.days.add(dayName(e.startDateTime, metro.tz));
        if (day === days[0]) prev.first = e; // earliest day owns the clock
        continue;
      }
      byKey.set(key, { first: e, days: new Set([dayName(e.startDateTime, metro.tz)]) });
    }

    const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    return [...byKey.values()].map((row) => {
      const e = row.first;
      const cost = COST(e.cost);
      const title = baseTitle(e.title);
      const freq = stemCount.get(title.toLowerCase().slice(0, 14)) || 1;
      let score = 0;
      score += cost.free ? 70 : 0;
      score += CAT_WEIGHT[e.category] ?? 22;
      score += Math.round(40 / Math.log2(freq + 2)); // distinctiveness, 0-25ish
      score += row.days.size > 1 ? 12 : 0;
      score += title.length >= 10 && title.length <= 46 ? 14 : 0;
      score -= title.length > 62 ? 30 : 0;
      score -= GENERIC.test(title) ? 60 : 0;
      score -= CHORE.test(title) ? 35 : 0;
      return {
        title, venue: e.venue, city: e.city, category: e.category,
        cost: cost.label, free: cost.free, ages: ageSummary(e.ageBands),
        days: [...row.days].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join(" + "),
        time: clock(e.startDateTime, metro.tz),
        url: e.url || e.sourceUrl,
        score,
      };
    }).sort((a, b) => b.score - a.score);
  };

  // Spread across venues and categories so six cards do not become one venue's
  // program listing.
  const choose = (pool) => {
    const picks = [];
    const venueUse = new Map();
    const catUse = new Map();
    const titleUse = new Set();
    // Three widening passes. A metro whose weekend genuinely clusters in one
    // park system (NYC) should still get six weekend cards rather than fall
    // through to weekday filler.
    const CAPS = [{ v: 1, k: 2 }, { v: 2, k: 3 }, { v: 3, k: 6 }];
    for (const cap of CAPS) {
      for (const c of pool) {
        if (picks.length === 6) break;
        if (picks.includes(c)) continue;
        if (c.score < SCORE_FLOOR) continue;
        if (titleUse.has(c.title.toLowerCase())) continue;
        const v = venueUse.get(c.venue) || 0, k = catUse.get(c.category) || 0;
        if (v >= cap.v || k >= cap.k) continue;
        picks.push(c);
        titleUse.add(c.title.toLowerCase());
        venueUse.set(c.venue, v + 1);
        catUse.set(c.category, k + 1);
      }
    }
    return picks;
  };

  // Weekend first. A metro that cannot fill six decent weekend cards gets the
  // whole week instead, with each card's real day on screen - a thin weekend
  // is a fact about the city's listings, not a licence to pad.
  const weekendPool = collect([SAT, SUN]);
  let picks = choose(weekendPool);
  let window = "weekend";
  if (picks.length < 6) {
    picks = choose(collect(WEEK));
    window = "week";
  }

  // The closing beat has to earn a click, so it shows a real narrowing: the
  // age band with the most free events this week, and its true count. Which
  // band wins varies by metro; the count is never invented, and a metro too
  // thin for a meaningful narrowing gets the plan payoff instead.
  const bandCounts = Object.keys(AGE_LABEL).map((band) => ({
    band,
    label: AGE_LABEL[band],
    count: weekFree.filter((e) => (e.ageBands || []).includes(band)).length,
  })).sort((a, b) => b.count - a.count);
  const band = bandCounts[0];

  // Four true counts, each one filter deeper. The drop is the argument: a list
  // of 895 is unusable, "135 free school-age mornings" is a Saturday.
  const cascade = [
    { chip: "", n: weekEvents.length },
    { chip: "Free", n: weekFree.length },
    { chip: band.label, n: band.count },
    { chip: "Morning", n: weekFree.filter((e) => (e.ageBands || []).includes(band.band) && e.timeWindow === "Morning").length },
  ];

  result.metros.push({
    id: metro.id, name: metro.name, tz: metro.tz,
    window,
    filterDemo: { label: band.label, cascade },
    // A cascade that bottoms out near zero is not a sales pitch; those metros
    // get the plan payoff, which does not depend on volume.
    payoff: cascade[3].n >= 5 ? "filter" : "plan",
    weekTotal: weekEvents.length,
    weekFree: weekFree.length,
    freeWeekendSupply: weekendPool.filter((c) => c.free).length,
    allFree: picks.length === 6 && picks.every((p) => p.free),
    picks,
  });
}

writeFileSync(join(HERE, "weekend-picks.json"), JSON.stringify(result, null, 2));

for (const m of result.metros) {
  console.log(`\n## ${m.name}  [${m.window.toUpperCase()}]  week ${m.weekTotal} / free ${m.weekFree} · free weekend supply ${m.freeWeekendSupply}${m.allFree ? " · ALL-FREE ✓" : ""}`);
  m.picks.forEach((p, i) =>
    console.log(`  ${String(i + 1).padStart(2, "0")} [${p.cost.padEnd(14)}] ${p.title}  ·  ${p.venue}, ${p.city}  ·  ${p.days} ${p.time}  [${p.category}]`)
  );
  if (m.picks.length < 6) console.log(`  !! only ${m.picks.length} picks`);
}
