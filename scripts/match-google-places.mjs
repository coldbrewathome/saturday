#!/usr/bin/env node
/**
 * One-time matcher: enrich curated-spots.json with canonical Google Places data.
 *
 * Usage:
 *   GOOGLE_PLACES_API_KEY=AIza... node scripts/match-google-places.mjs
 *
 * Optional flags:
 *   --dry-run                Don't write back; only emit match-report.json.
 *   --limit=N                Only process the first N entries (handy for testing).
 *   --keep-closed            Keep entries Google flags CLOSED_PERMANENTLY
 *                            (default: move them to a "dropped" list).
 *
 * What it does for each curated spot:
 *   1. Find Place from Text using "{name} {neighborhood}, CA"
 *      (Places API "v1:places:searchText" — new endpoint, includes
 *      formattedAddress, location, business_status).
 *   2. Place Details on the matched place_id (website, phone, opening hours).
 *   3. Merges canonical fields into the entry, sets verified=true when
 *      OPERATIONAL, leaves verified=false when uncertain.
 *
 * Cost: ~$0.034 per entry (one Text Search + one Details). 86 entries ≈ $3.
 */
import { readFileSync, writeFileSync } from "node:fs";

const apiKey = process.env.GOOGLE_PLACES_API_KEY;
if (!apiKey) {
  console.error("Missing GOOGLE_PLACES_API_KEY env var.");
  process.exit(1);
}

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const keepClosed = args.includes("--keep-closed");
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Number(limitArg.split("=")[1]) : Infinity;

const filePath = "public/data/curated-spots.json";
const reportPath = "public/data/curated-spots-match-report.json";
const file = JSON.parse(readFileSync(filePath, "utf8"));
const spots = Array.isArray(file.spots) ? file.spots : [];

const SF_NEIGHBORHOODS = new Set([
  "Mission",
  "Inner Richmond",
  "Outer Richmond",
  "Inner Sunset",
  "Outer Sunset",
  "Sunset",
  "North Beach",
  "Chinatown",
  "SoMa",
  "Civic Center",
  "Castro",
  "Hayes Valley",
  "Marina",
  "Pacific Heights",
  "Russian Hill",
  "Nob Hill",
  "Tenderloin",
  "Bayview",
  "Bernal Heights",
  "Glen Park",
  "Noe Valley",
  "Excelsior",
  "Visitacion Valley",
  "Pier 39",
  "Embarcadero",
  "The Presidio",
  "Golden Gate Park",
  "Lincoln Park",
  "Japantown",
  "Fisherman's Wharf",
]);

const CATEGORY_HINT = {
  Food: "restaurant",
  Culture: "museum",
  Wellness: "",
  Outdoors: "",
  Shopping: "",
};

function buildQuery(spot, includeHint = true) {
  const nb = spot.neighborhood ?? "";
  const hint = CATEGORY_HINT[spot.category] ?? "";
  const namePart = includeHint && hint ? `${spot.name} ${hint}` : spot.name;
  if (SF_NEIGHBORHOODS.has(nb)) {
    return `${namePart}, ${nb}, San Francisco, CA`;
  }
  if (nb === "Stanford" || nb === "Stanford Campus") {
    return `${namePart}, Stanford University, Palo Alto, CA`;
  }
  return `${namePart}, ${nb}, CA`;
}

const CATEGORY_INCLUDED_TYPE = {
  Food: "restaurant",
  // Culture / Wellness / Outdoors / Shopping have too much variance to filter
  // safely (e.g., libraries, museums, theaters all live under Culture).
};

const FOOD_TYPES = new Set([
  "restaurant",
  "food",
  "cafe",
  "bakery",
  "bar",
  "coffee_shop",
  "ice_cream_shop",
  "pizza_restaurant",
  "meal_takeaway",
  "meal_delivery",
  "fast_food_restaurant",
  "sandwich_shop",
  "barbecue_restaurant",
  "asian_restaurant",
  "italian_restaurant",
  "mexican_restaurant",
  "chinese_restaurant",
  "japanese_restaurant",
  "indian_restaurant",
  "mediterranean_restaurant",
  "middle_eastern_restaurant",
  "seafood_restaurant",
  "steak_house",
  "vegan_restaurant",
  "vegetarian_restaurant",
  "diner",
  "deli",
  "donut_shop",
]);

const NAME_STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "of",
  "in",
  "at",
  "on",
  "to",
  "for",
  "restaurant",
  "cafe",
  "bakery",
  "kitchen",
  "bar",
  "co",
  "company",
  "shop",
  "house",
  "place",
  "ave",
  "blvd",
  "st",
  "rd",
]);

function meaningfulTokens(name) {
  return new Set(
    String(name || "")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 3 && !NAME_STOP_WORDS.has(t)),
  );
}

function isPlausibleMatch(spot, match) {
  if (!match || !match.displayName) return false;
  const matchedName = match.displayName?.text ?? "";
  const ours = meaningfulTokens(spot.name);
  const theirs = meaningfulTokens(matchedName);
  let shared = 0;
  for (const token of ours) {
    if (theirs.has(token)) shared += 1;
  }
  // Require at least one meaningful shared token, OR substring match
  // (with whitespace collapsed, so "Dish Dash" ≈ "Dishdash").
  const collapse = (s) => s.toLowerCase().replace(/\s+/g, "");
  const ourCollapsed = collapse(spot.name);
  const theirsCollapsed = collapse(matchedName);
  const nameOk =
    shared >= 1 ||
    theirsCollapsed.includes(ourCollapsed) ||
    ourCollapsed.includes(theirsCollapsed);
  if (!nameOk) return false;
  // For Food entries, require a food-shaped type.
  if (spot.category === "Food") {
    const types = Array.isArray(match.types) ? match.types : [];
    const hasFoodType = types.some((t) => FOOD_TYPES.has(t));
    if (!hasFoodType) return false;
  }
  return true;
}

const TEXT_SEARCH_URL = "https://places.googleapis.com/v1/places:searchText";
const PLACE_DETAILS_URL = (id) => `https://places.googleapis.com/v1/places/${id}`;

const SEARCH_FIELDS = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.location",
  "places.businessStatus",
  "places.types",
].join(",");

const DETAIL_FIELDS = [
  "id",
  "displayName",
  "formattedAddress",
  "location",
  "businessStatus",
  "websiteUri",
  "internationalPhoneNumber",
  "regularOpeningHours",
  "primaryTypeDisplayName",
  "rating",
  "userRatingCount",
].join(",");

async function searchTextOnce(query, biasCenter, opts = {}) {
  const body = {
    textQuery: query,
    languageCode: "en",
    regionCode: "us",
    maxResultCount: 3,
  };
  if (opts.includedType) {
    body.includedType = opts.includedType;
  }
  if (
    biasCenter &&
    typeof biasCenter.lat === "number" &&
    typeof biasCenter.lon === "number"
  ) {
    body.locationBias = {
      circle: {
        center: { latitude: biasCenter.lat, longitude: biasCenter.lon },
        radius: opts.radius ?? 4000,
      },
    };
  }
  const response = await fetch(TEXT_SEARCH_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": SEARCH_FIELDS,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Text Search failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  const result = await response.json();
  return Array.isArray(result.places) && result.places.length > 0
    ? result.places[0]
    : null;
}

async function searchText(spot, query, queryNoHint, biasCenter, includedType) {
  const tiers = [
    { q: query, opts: { includedType, radius: 4000 } },
    { q: queryNoHint, opts: { radius: 4000 } },
    { q: queryNoHint, opts: { radius: 10000 } },
  ];
  for (const tier of tiers) {
    const match = await searchTextOnce(tier.q, biasCenter, tier.opts);
    if (match && isPlausibleMatch(spot, match)) {
      return match;
    }
  }
  return null;
}

async function placeDetails(placeId) {
  const response = await fetch(PLACE_DETAILS_URL(placeId), {
    method: "GET",
    headers: {
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": DETAIL_FIELDS,
    },
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Place Details failed (${response.status}): ${detail.slice(0, 200)}`);
  }
  return response.json();
}

const report = {
  generatedAt: new Date().toISOString(),
  total: 0,
  matched: 0,
  unmatched: 0,
  closed: 0,
  errors: 0,
  entries: [],
};

const updatedSpots = [];
const droppedSpots = [];

const toProcess = spots.slice(0, Math.min(spots.length, limit));
console.log(`Matching ${toProcess.length} of ${spots.length} entries…`);

for (let i = 0; i < toProcess.length; i += 1) {
  const spot = toProcess[i];
  const query = buildQuery(spot, true);
  const queryNoHint = buildQuery(spot, false);
  const includedType = CATEGORY_INCLUDED_TYPE[spot.category];
  report.total += 1;
  try {
    const match = await searchText(
      spot,
      query,
      queryNoHint,
      { lat: spot.lat, lon: spot.lon },
      includedType,
    );
    if (!match || !match.id) {
      report.unmatched += 1;
      report.entries.push({ id: spot.id, query, status: "no-match" });
      updatedSpots.push(spot);
      console.log(`[${i + 1}/${toProcess.length}] ✗ no match  ${spot.id}`);
      continue;
    }
    const details = await placeDetails(match.id);
    const status = details.businessStatus || match.businessStatus || "OPERATIONAL";
    if (status === "CLOSED_PERMANENTLY" && !keepClosed) {
      report.closed += 1;
      droppedSpots.push({
        ...spot,
        googlePlaceId: match.id,
        businessStatus: status,
      });
      report.entries.push({
        id: spot.id,
        query,
        status: "dropped-closed",
        placeId: match.id,
      });
      console.log(`[${i + 1}/${toProcess.length}] ✗ CLOSED   ${spot.id}`);
      continue;
    }
    const lat = details?.location?.latitude ?? match?.location?.latitude;
    const lon = details?.location?.longitude ?? match?.location?.longitude;
    const address = details.formattedAddress || match.formattedAddress || "";
    // "190 S Murphy Ave, Sunnyvale, CA 94086, USA" → "Sunnyvale"
    // Take the segment before the "STATE ZIP" segment.
    const segments = address.split(",").map((s) => s.trim());
    const stateIdx = segments.findIndex((s) => /^[A-Z]{2}\s/.test(s));
    const canonicalCity =
      stateIdx > 0 ? segments[stateIdx - 1] : spot.neighborhood;
    const enriched = {
      ...spot,
      lat: typeof lat === "number" ? Number(lat.toFixed(6)) : spot.lat,
      lon: typeof lon === "number" ? Number(lon.toFixed(6)) : spot.lon,
      neighborhood: canonicalCity || spot.neighborhood,
      address: address || undefined,
      website: details.websiteUri || spot.website || undefined,
      phone: details.internationalPhoneNumber || undefined,
      googlePlaceId: match.id,
      googleRating:
        typeof details.rating === "number" ? details.rating : undefined,
      googleRatingCount:
        typeof details.userRatingCount === "number"
          ? details.userRatingCount
          : undefined,
      googleType: details?.primaryTypeDisplayName?.text ?? undefined,
      openingHours: details?.regularOpeningHours?.weekdayDescriptions
        ? details.regularOpeningHours.weekdayDescriptions.join("; ")
        : spot.openingHours,
      businessStatus: status,
      verified: status === "OPERATIONAL",
    };
    report.matched += 1;
    report.entries.push({
      id: spot.id,
      query,
      status: "matched",
      placeId: match.id,
      address: enriched.address,
      operational: status === "OPERATIONAL",
    });
    updatedSpots.push(enriched);
    console.log(
      `[${i + 1}/${toProcess.length}] ✓ ${spot.id}  →  ${match.displayName?.text || match.id}`,
    );
  } catch (error) {
    report.errors += 1;
    report.entries.push({
      id: spot.id,
      query,
      status: "error",
      error: error.message,
    });
    updatedSpots.push(spot);
    console.error(`[${i + 1}/${toProcess.length}] ! error    ${spot.id}: ${error.message}`);
  }
}

// Append untouched spots beyond the limit.
if (toProcess.length < spots.length) {
  for (let i = toProcess.length; i < spots.length; i += 1) {
    updatedSpots.push(spots[i]);
  }
}

if (!dryRun) {
  const next = {
    ...file,
    generatedAt: new Date().toISOString(),
    spots: updatedSpots,
    droppedSpots: droppedSpots.length > 0 ? droppedSpots : undefined,
  };
  writeFileSync(filePath, JSON.stringify(next, null, 2) + "\n");
  console.log(`\nWrote ${updatedSpots.length} spots to ${filePath}`);
  if (droppedSpots.length > 0) {
    console.log(`Dropped ${droppedSpots.length} CLOSED_PERMANENTLY entries.`);
  }
} else {
  console.log("\n(dry run — file not modified)");
}

writeFileSync(reportPath, JSON.stringify(report, null, 2) + "\n");
console.log(`Report written to ${reportPath}`);
console.log(
  `Summary: ${report.matched} matched, ${report.unmatched} unmatched, ${report.closed} closed, ${report.errors} errors`,
);
