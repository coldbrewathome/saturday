/**
 * Shared helpers for matching internal spots to Google Places (v1).
 * Used by scripts/match-google-places.mjs (curated spots) and
 * scripts/match-google-places-osm.mjs (OSM dataset, sidecar enrichment).
 */

export const SF_NEIGHBORHOODS = new Set([
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

export const CATEGORY_HINT = {
  Food: "restaurant",
  Culture: "museum",
  Wellness: "",
  Outdoors: "",
  Shopping: "",
};

export const CATEGORY_INCLUDED_TYPE = {
  Food: "restaurant",
  // Culture / Wellness / Outdoors / Shopping have too much variance to filter
  // safely (e.g., libraries, museums, theaters all live under Culture).
};

export const FOOD_TYPES = new Set([
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

export function buildQuery(spot, includeHint = true) {
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

export function isPlausibleMatch(spot, match) {
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
  "photos",
].join(",");

export function createPlacesClient(apiKey) {
  if (!apiKey) throw new Error("createPlacesClient requires apiKey");

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
      throw new Error(
        `Text Search failed (${response.status}): ${detail.slice(0, 200)}`,
      );
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
      throw new Error(
        `Place Details failed (${response.status}): ${detail.slice(0, 200)}`,
      );
    }
    return response.json();
  }

  // Resolve the first photo to a stable CDN URL we can store and serve directly.
  // skipHttpRedirect=true returns JSON with the underlying lh3.googleusercontent.com
  // URL instead of a 302 to a binary, which we couldn't otherwise capture.
  async function fetchPlacePhoto(details) {
    const photo = Array.isArray(details?.photos) ? details.photos[0] : null;
    if (!photo?.name) return null;
    const params = new URLSearchParams({
      maxWidthPx: "1200",
      skipHttpRedirect: "true",
    });
    const url = `https://places.googleapis.com/v1/${photo.name}/media?${params}`;
    const response = await fetch(url, {
      headers: { "X-Goog-Api-Key": apiKey },
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `Photo Media failed (${response.status}): ${detail.slice(0, 200)}`,
      );
    }
    const result = await response.json();
    if (!result?.photoUri) return null;
    const author =
      Array.isArray(photo.authorAttributions) &&
      photo.authorAttributions[0]?.displayName
        ? photo.authorAttributions[0].displayName
        : null;
    return {
      url: result.photoUri,
      attribution: author ? `Photo: ${author}` : "Photo via Google Places",
    };
  }

  return { searchText, placeDetails, fetchPlacePhoto };
}

// Compute the canonical city from a Google formatted address.
// "190 S Murphy Ave, Sunnyvale, CA 94086, USA" → "Sunnyvale"
function canonicalCityFromAddress(address, fallback) {
  if (!address) return fallback;
  const segments = address.split(",").map((s) => s.trim());
  const stateIdx = segments.findIndex((s) => /^[A-Z]{2}\s/.test(s));
  return stateIdx > 0 ? segments[stateIdx - 1] : fallback;
}

// Build the canonical enrichment fields from a match + details + optional photo.
// Callers decide whether to merge into the original spot (curated) or store as
// a sidecar (OSM). Returns only the fields we actually update.
export function buildEnrichment({ spot, match, details, photo }) {
  const lat = details?.location?.latitude ?? match?.location?.latitude;
  const lon = details?.location?.longitude ?? match?.location?.longitude;
  const address = details.formattedAddress || match.formattedAddress || "";
  const status = details.businessStatus || match.businessStatus || "OPERATIONAL";
  const enrichment = {
    lat: typeof lat === "number" ? Number(lat.toFixed(6)) : spot.lat,
    lon: typeof lon === "number" ? Number(lon.toFixed(6)) : spot.lon,
    neighborhood: canonicalCityFromAddress(address, spot.neighborhood),
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
  if (photo) {
    enrichment.imageUrl = photo.url;
    enrichment.imageSource = "Google Places";
    enrichment.imageAttribution = photo.attribution;
  }
  return enrichment;
}
