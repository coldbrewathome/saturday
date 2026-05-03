import crypto from "node:crypto";

export const BAY_AREA_BBOX = {
  south: 36.85,
  west: -123.05,
  north: 38.95,
  east: -121.15,
};

export const BAY_AREA_BOXES = [
  { name: "San Francisco and Peninsula", south: 37.2, west: -122.55, north: 37.82, east: -122.05 },
  { name: "South Bay", south: 37.15, west: -122.15, north: 37.55, east: -121.75 },
  { name: "East Bay", south: 37.45, west: -122.35, north: 38.15, east: -121.65 },
  { name: "Marin and North Bay", south: 37.85, west: -122.75, north: 38.55, east: -122.25 },
];

export const OVERPASS_ENDPOINT =
  process.env.OVERPASS_ENDPOINT || "https://overpass-api.de/api/interpreter";

const UNSPLASH = (id) =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=1200&q=80`;

export const CATEGORY_IMAGES = {
  Food: [
    "1495474472287-4d71bcdd2085",
    "1555396273-367ea4eb4db5",
    "1517248135467-4c7edcad34c4",
    "1481833761820-0509d3217039",
    "1414235077428-338989a2e8c0",
    "1424847651672-bf20a4b0982b",
    "1610890716171-6b1bb98ffd09",
    "1504674900247-0877df9cc836",
    "1565299624946-b28f40a0ae38",
    "1559339352-11d035aa65de",
  ].map(UNSPLASH),
  Outdoors: [
    "1500530855697-b586d89ba3ee",
    "1469474968028-56623f02e42e",
    "1501785888041-af3ef285b470",
    "1502082553048-f009c37129b9",
    "1464822759023-fed622ff2c3b",
    "1473773508845-188df298d2d1",
    "1441974231531-c6227db76b6e",
    "1506905925346-21bda4d32df4",
    "1418065460487-3e41a6c84dc5",
  ].map(UNSPLASH),
  Culture: [
    "1518998053901-5348d3961a04",
    "1554907984-15263bfd63bd",
    "1564399579883-451a5d44ec08",
    "1583847268964-b28dc8f51f92",
    "1485738422979-f5c462d49f74",
    "1503095396549-807759245b35",
  ].map(UNSPLASH),
  Nightlife: [
    "1501386761578-eac5c94b800a",
    "1566417713940-fe7c737a9ef2",
    "1572116469696-31de0f17cc34",
    "1543007630-9710e4a00a20",
    "1559329007-40df8a9345d8",
    "1521587760476-6c12a4b040da",
    "1470337458703-46ad1756a187",
  ].map(UNSPLASH),
  Wellness: [
    "1626224583764-f87db24ac4ea",
    "1518611012118-696072aa579a",
    "1571902943202-507ec2618e8f",
    "1599901860904-17e6ed7083a0",
    "1545205597-3d9d02c29597",
    "1571388208497-71bedc66e932",
    "1506629082955-511b1aa562c8",
    "1518609878373-06d740f60d8b",
  ].map(UNSPLASH),
  Shopping: [
    "1441986300917-64674bd600d8",
    "1481437156560-3205f6a55735",
    "1555529669-e69e7aa0ba9a",
    "1567401893414-76b7b1e5a7a5",
    "1549298916-b41d501d3772",
    "1483985988355-763728e1935b",
    "1472851294608-062f824d29cc",
    "1555529771-7888783a18d3",
  ].map(UNSPLASH),
};

export function pickCategoryImage(category, key) {
  const pool = CATEGORY_IMAGES[category] || CATEGORY_IMAGES.Outdoors;
  let hash = 0;
  for (let i = 0; i < key.length; i += 1) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return pool[hash % pool.length];
}

const SF_CENTER = { lat: 37.7749, lon: -122.4194 };

const CITY_CENTERS = [
  ["San Francisco", 37.7749, -122.4194],
  ["Oakland", 37.8044, -122.2712],
  ["Berkeley", 37.8715, -122.273],
  ["San Jose", 37.3382, -121.8863],
  ["Palo Alto", 37.4419, -122.143],
  ["Mountain View", 37.3861, -122.0839],
  ["Sunnyvale", 37.3688, -122.0363],
  ["Santa Clara", 37.3541, -121.9552],
  ["Fremont", 37.5485, -121.9886],
  ["Hayward", 37.6688, -122.0808],
  ["San Mateo", 37.563, -122.3255],
  ["Redwood City", 37.4852, -122.2364],
  ["Daly City", 37.6879, -122.4702],
  ["Walnut Creek", 37.9101, -122.0652],
  ["Livermore", 37.6819, -121.768],
  ["Sausalito", 37.8591, -122.4853],
  ["San Rafael", 37.9735, -122.5311],
  ["Napa", 38.2975, -122.2869],
  ["Petaluma", 38.2324, -122.6367],
  ["Santa Rosa", 38.4404, -122.7141],
];

const TAG_RULES = [
  {
    key: "amenity",
    values: [
      "bar",
      "biergarten",
      "cafe",
      "fast_food",
      "food_court",
      "ice_cream",
      "pub",
      "restaurant",
    ],
  },
  {
    key: "amenity",
    values: ["arts_centre", "cinema", "community_centre", "theatre"],
  },
  {
    key: "leisure",
    values: [
      "bowling_alley",
      "dance",
      "escape_game",
      "fitness_centre",
      "garden",
      "miniature_golf",
      "park",
      "pitch",
      "sports_centre",
      "swimming_pool",
    ],
  },
  {
    key: "tourism",
    values: [
      "aquarium",
      "artwork",
      "attraction",
      "gallery",
      "museum",
      "theme_park",
      "viewpoint",
      "zoo",
    ],
  },
  {
    key: "shop",
    values: ["books", "mall", "music", "outdoor", "sports"],
  },
];

export function buildOverpassQuery(boxes = BAY_AREA_BOXES) {
  const selectors = TAG_RULES.flatMap((rule) => {
    const values = rule.values.join("|");
    return boxes.flatMap((bbox) => {
      const box = `${bbox.south},${bbox.west},${bbox.north},${bbox.east}`;
      return [
        `node["name"]["${rule.key}"~"^(${values})$"](${box});`,
        `way["name"]["${rule.key}"~"^(${values})$"](${box});`,
        `relation["name"]["${rule.key}"~"^(${values})$"](${box});`,
      ];
    });
  }).join("\n  ");

  return `[out:json][timeout:120];
(
  ${selectors}
);
out center tags;`;
}

export function hashQuery(query) {
  return crypto.createHash("sha256").update(query).digest("hex").slice(0, 16);
}

export function stripUnsafeText(value, maxLength = 180) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeUrl(value) {
  const trimmed = stripUnsafeText(value, 300);
  if (!trimmed) {
    return null;
  }

  const candidate = /^https?:\/\//i.test(trimmed)
    ? trimmed
    : trimmed.startsWith("www.")
      ? `https://${trimmed}`
      : "";

  if (!candidate) {
    return null;
  }

  try {
    const url = new URL(candidate);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function looksLikeImageUrl(value) {
  return (
    /\.(avif|gif|jpe?g|png|webp)(\?.*)?$/i.test(value) ||
    /commons\.wikimedia\.org\/wiki\/Special:FilePath\//i.test(value)
  );
}

export function normalizeWikidataId(value) {
  const id = stripUnsafeText(value, 20).toUpperCase();
  return /^Q\d+$/.test(id) ? id : null;
}

export function commonsFileUrl(value) {
  const raw = stripUnsafeText(value, 240);
  if (!raw || /^Category:/i.test(raw)) {
    return null;
  }

  let fileName = raw;
  const filePathMatch = raw.match(/Special:FilePath\/([^?#]+)/i);
  const filePageMatch = raw.match(/\/wiki\/File:([^?#]+)/i);

  if (filePathMatch) {
    fileName = decodeURIComponent(filePathMatch[1]);
  } else if (filePageMatch) {
    fileName = decodeURIComponent(filePageMatch[1]);
  } else if (/^File:/i.test(fileName)) {
    fileName = fileName.replace(/^File:/i, "");
  }

  if (!fileName || /^Category:/i.test(fileName)) {
    return null;
  }

  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(
    fileName.replace(/_/g, " "),
  )}?width=1200`;
}

export function imageFromTags(tags = {}, category, key) {
  const directImage = sanitizeUrl(tags.image);
  if (directImage && looksLikeImageUrl(directImage)) {
    return {
      url: directImage,
      source: "OSM image tag",
      attribution: "Source image from OpenStreetMap tag",
    };
  }

  const imageCommonsFile = commonsFileUrl(tags.image);
  if (imageCommonsFile) {
    return {
      url: imageCommonsFile,
      source: "Wikimedia Commons",
      attribution: "Wikimedia Commons",
    };
  }

  const commonsImage = commonsFileUrl(tags.wikimedia_commons);
  if (commonsImage) {
    return {
      url: commonsImage,
      source: "Wikimedia Commons",
      attribution: "Wikimedia Commons",
    };
  }

  return {
    url: pickCategoryImage(category, key),
    source: "Category fallback",
    attribution: "Category image",
  };
}

export function isInBayArea(lat, lon, boxes = BAY_AREA_BOXES) {
  return boxes.some(
    (bbox) =>
      lat >= bbox.south &&
      lat <= bbox.north &&
      lon >= bbox.west &&
      lon <= bbox.east,
  );
}

export function elementCoordinates(element) {
  const lat = Number(element.lat ?? element.center?.lat);
  const lon = Number(element.lon ?? element.center?.lon);

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return null;
  }

  return { lat, lon };
}

export function inferCategory(tags = {}) {
  const amenity = tags.amenity;
  const leisure = tags.leisure;
  const tourism = tags.tourism;
  const shop = tags.shop;

  if (["bar", "biergarten", "pub"].includes(amenity)) {
    return "Nightlife";
  }

  if (
    ["cafe", "fast_food", "food_court", "ice_cream", "restaurant"].includes(
      amenity,
    )
  ) {
    return "Food";
  }

  if (["arts_centre", "cinema", "community_centre", "theatre"].includes(amenity)) {
    return "Culture";
  }

  if (["bowling_alley", "dance", "escape_game", "miniature_golf"].includes(leisure)) {
    return "Nightlife";
  }

  if (["fitness_centre", "pitch", "sports_centre", "swimming_pool"].includes(leisure)) {
    return "Wellness";
  }

  if (["garden", "park"].includes(leisure) || tourism === "viewpoint") {
    return "Outdoors";
  }

  if (
    ["aquarium", "artwork", "attraction", "gallery", "museum", "theme_park", "zoo"].includes(
      tourism,
    )
  ) {
    return "Culture";
  }

  if (["books", "mall", "music", "outdoor", "sports"].includes(shop)) {
    return "Shopping";
  }

  return "Culture";
}

export function deriveCost(category, tags = {}) {
  if (tags.fee === "no" || category === "Outdoors") {
    return "Free";
  }

  if (tags.fee === "yes" || ["Nightlife", "Culture"].includes(category)) {
    return "$$";
  }

  if (category === "Shopping") {
    return "Unknown";
  }

  return "$";
}

export function deriveMood(category, tags = {}) {
  if (category === "Food") {
    return tags.amenity === "cafe" ? "Coffee and conversation" : "Shareable food";
  }

  if (category === "Nightlife") {
    return tags.leisure === "escape_game" ? "Group challenge" : "After-dark energy";
  }

  if (category === "Outdoors") {
    return tags.tourism === "viewpoint" ? "View stop" : "Outside hangout";
  }

  if (category === "Wellness") {
    return "Light activity";
  }

  if (category === "Shopping") {
    return "Browse together";
  }

  return "Wander and compare notes";
}

export function deriveGroupSize(category, tags = {}) {
  if (tags.leisure === "escape_game") {
    return "3-8 people";
  }

  if (["bar", "pub", "biergarten"].includes(tags.amenity)) {
    return "3-6 people";
  }

  if (["park", "garden"].includes(tags.leisure)) {
    return "2-12 people";
  }

  if (category === "Wellness") {
    return "2-4 people";
  }

  if (category === "Shopping") {
    return "2-5 people";
  }

  return "2-6 people";
}

export function derivePlanning(category, tags = {}) {
  if (tags.reservation === "required" || tags.leisure === "escape_game") {
    return "Book ahead";
  }

  if (category === "Nightlife" || category === "Culture") {
    return "Check hours";
  }

  if (category === "Outdoors") {
    return "Flexible";
  }

  return "Walk-in";
}

export function deriveTimeWindow(category, tags = {}) {
  if (["bar", "biergarten", "pub"].includes(tags.amenity)) {
    return "Evening";
  }

  if (category === "Food") {
    return tags.amenity === "cafe" ? "Morning" : "Lunch";
  }

  if (category === "Outdoors") {
    return "Daylight";
  }

  if (category === "Nightlife") {
    return "Evening";
  }

  return "Afternoon";
}

export function friendScore(category, tags = {}) {
  let score = {
    Food: 82,
    Nightlife: 84,
    Outdoors: 78,
    Culture: 72,
    Wellness: 70,
    Shopping: 62,
  }[category] ?? 60;

  if (tags.opening_hours) score += 5;
  if (tags.website || tags["contact:website"]) score += 4;
  if (tags.amenity === "food_court") score += 6;
  if (tags.leisure === "escape_game") score += 8;
  if (tags.tourism === "viewpoint") score += 5;
  if (tags.access === "private" || tags.disused) score -= 50;

  return Math.max(0, Math.min(100, score));
}

export function haversineMiles(a, b = SF_CENTER) {
  const radiusMiles = 3958.8;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radiusMiles * 2 * Math.asin(Math.sqrt(h));
}

export function nearestCity(coords) {
  if (!coords) {
    return "Bay Area";
  }

  let best = ["Bay Area", Number.POSITIVE_INFINITY];
  for (const [name, lat, lon] of CITY_CENTERS) {
    const miles = haversineMiles({ lat: coords.lat, lon: coords.lon }, { lat, lon });
    if (miles < best[1]) {
      best = [name, miles];
    }
  }

  return best[0];
}

const CITY_ALIASES = {
  "berkley": "Berkeley",
  "milbrae": "Millbrae",
  "san jose": "San Jose",
  "pt richmond": "Richmond",
  "point richmond": "Richmond",
};

export function normalizeCity(value) {
  if (!value) {
    return value;
  }
  const stripped = value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!stripped) {
    return stripped;
  }
  const alias = CITY_ALIASES[stripped.toLowerCase()];
  if (alias) {
    return alias;
  }
  if (stripped === stripped.toUpperCase() && /[A-Z]/.test(stripped)) {
    return stripped
      .toLowerCase()
      .replace(/\b([a-z])/g, (m) => m.toUpperCase());
  }
  return stripped;
}

export function extractCity(tags = {}, coords) {
  const raw =
    stripUnsafeText(tags["addr:city"], 60) ||
    stripUnsafeText(tags["is_in:city"], 60) ||
    stripUnsafeText(tags["addr:suburb"], 60) ||
    nearestCity(coords);
  return normalizeCity(raw);
}

const DAY_INDEX = { Mo: 0, Tu: 1, We: 2, Th: 3, Fr: 4, Sa: 5, Su: 6 };
const DAY_KEYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function expandDayList(spec) {
  const parts = spec.split(",").map((p) => p.trim()).filter(Boolean);
  const result = [];
  for (const part of parts) {
    if (part.includes("-")) {
      const [a, b] = part.split("-").map((s) => s.trim());
      if (DAY_INDEX[a] === undefined || DAY_INDEX[b] === undefined) {
        return null;
      }
      let i = DAY_INDEX[a];
      const end = DAY_INDEX[b];
      for (let safety = 0; safety < 8; safety += 1) {
        result.push(i);
        if (i === end) break;
        i = (i + 1) % 7;
      }
    } else {
      if (DAY_INDEX[part] === undefined) {
        return null;
      }
      result.push(DAY_INDEX[part]);
    }
  }
  return result;
}

function timeToMinutes(value) {
  const match = value.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h < 0 || h > 24 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

export function parseOpeningHours(raw) {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "24/7") {
    return { is247: true, days: null };
  }
  if (/\|\||"|sunset|sunrise|easter|week\s|PH|SH/i.test(trimmed)) {
    return null;
  }

  const days = [[], [], [], [], [], [], []];
  const groupRe =
    /([A-Za-z]{2}(?:-[A-Za-z]{2})?(?:,[A-Za-z]{2}(?:-[A-Za-z]{2})?)*)\s+(off|closed|\d{1,2}:\d{2}\s*-\s*\d{1,2}:\d{2})/gi;

  for (const rule of trimmed.split(";")) {
    const r = rule.trim();
    if (!r) continue;
    const matches = [...r.matchAll(groupRe)];
    if (matches.length === 0) {
      return null;
    }
    for (const match of matches) {
      const dayList = expandDayList(match[1]);
      const window = match[2].toLowerCase();
      if (!dayList) return null;
      if (window === "off" || window === "closed") {
        for (const d of dayList) days[d] = [];
        continue;
      }
      const [openRaw, closeRaw] = window.split("-").map((s) => s.trim());
      const open = timeToMinutes(openRaw);
      const close = timeToMinutes(closeRaw);
      if (open === null || close === null) return null;
      for (const d of dayList) {
        days[d].push({ open, close });
      }
    }
  }

  if (days.every((d) => d.length === 0)) {
    return null;
  }

  const out = {};
  days.forEach((slots, idx) => {
    out[DAY_KEYS[idx]] = slots;
  });
  return { is247: false, days: out };
}

export function extractFeatures(tags = {}) {
  const yesLike = (value) => {
    if (typeof value !== "string") return null;
    const v = value.toLowerCase().trim();
    if (["yes", "designated", "permissive", "allowed"].includes(v)) return true;
    if (["no", "private", "prohibited"].includes(v)) return false;
    return null;
  };
  const wheelchairValue =
    typeof tags.wheelchair === "string" ? tags.wheelchair.toLowerCase().trim() : null;
  const wheelchair =
    wheelchairValue === "yes" || wheelchairValue === "limited" || wheelchairValue === "no"
      ? wheelchairValue
      : null;
  const dogsAllowed = yesLike(tags.dog);
  const kidsFriendly =
    yesLike(tags.kids) ??
    yesLike(tags["family_friendly"]) ??
    (typeof tags.min_age === "string" && /^\s*0\s*$/.test(tags.min_age) ? true : null);
  const parkingNearby =
    yesLike(tags.parking) ??
    yesLike(tags["parking:fee"]) ??
    yesLike(tags["amenity:parking"]);
  return { wheelchair, dogsAllowed, kidsFriendly, parkingNearby };
}

export function extractFriendlyTags(category, tags = {}) {
  return Array.from(
    new Set(
      [
        "Friends",
        category,
        stripUnsafeText(tags.amenity, 24),
        stripUnsafeText(tags.leisure, 24),
        stripUnsafeText(tags.tourism, 24),
        stripUnsafeText(tags.shop, 24),
      ].filter(Boolean),
    ),
  ).slice(0, 6);
}

export function normalizeElement(element, generatedAt = new Date().toISOString()) {
  const tags = element.tags ?? {};
  const name = stripUnsafeText(tags.name, 90);
  const coords = elementCoordinates(element);

  if (!name || !coords || !isInBayArea(coords.lat, coords.lon)) {
    return null;
  }

  if (tags.access === "private" || tags.disused || tags.demolished) {
    return null;
  }

  const category = inferCategory(tags);
  const sourceUrl = `https://www.openstreetmap.org/${element.type}/${element.id}`;
  const website = sanitizeUrl(tags.website || tags["contact:website"]);
  const distanceMiles = haversineMiles({ lat: coords.lat, lon: coords.lon });
  const transitMinutes = Math.max(8, Math.round(distanceMiles * 2.3 + 8));
  const openingHours = stripUnsafeText(tags.opening_hours, 120);
  const score = friendScore(category, tags);

  const id = `osm-${element.type}-${element.id}`;
  const image = imageFromTags(tags, category, id);
  const schedule = parseOpeningHours(openingHours);
  const features = extractFeatures(tags);

  return {
    id,
    name,
    neighborhood: extractCity(tags, coords),
    category,
    imageUrl: image.url,
    imageSource: image.source,
    imageAttribution: image.attribution,
    bestWith: ["friends"],
    cost: deriveCost(category, tags),
    transitMinutes,
    distanceMiles: Number(distanceMiles.toFixed(1)),
    timeWindow: deriveTimeWindow(category, tags),
    mood: deriveMood(category, tags),
    groupSize: deriveGroupSize(category, tags),
    planning: derivePlanning(category, tags),
    openNow: Boolean(openingHours),
    note: buildNote(category, tags, openingHours, coords),
    tags: extractFriendlyTags(category, tags),
    lat: Number(coords.lat.toFixed(6)),
    lon: Number(coords.lon.toFixed(6)),
    sourceUrl,
    website,
    wikidataId: normalizeWikidataId(tags.wikidata),
    wikipedia: stripUnsafeText(tags.wikipedia, 120) || null,
    openingHours: openingHours || null,
    schedule,
    wheelchair: features.wheelchair,
    dogsAllowed: features.dogsAllowed,
    kidsFriendly: features.kidsFriendly,
    parkingNearby: features.parkingNearby,
    dataSource: "OpenStreetMap",
    updatedAt: generatedAt,
    friendScore: score,
  };
}

export function buildNote(category, tags = {}, _openingHours = "", coords) {
  const descriptor = deriveMood(category, tags);
  const city = extractCity(tags, coords);
  return stripUnsafeText(`${descriptor} in ${city}.`, 180);
}

export function dedupeAndRank(spots, limit = 500) {
  const seen = new Set();
  const deduped = [];

  for (const spot of spots) {
    const key = [
      spot.name.toLowerCase(),
      Math.round(spot.lat * 1000),
      Math.round(spot.lon * 1000),
    ].join("|");

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(spot);
  }

  const rank = (left, right) => {
    if (right.friendScore !== left.friendScore) {
      return right.friendScore - left.friendScore;
    }

    if (left.transitMinutes !== right.transitMinutes) {
      return left.transitMinutes - right.transitMinutes;
    }

    return left.name.localeCompare(right.name);
  };

  const sorted = deduped.sort(rank);
  const categories = ["Food", "Nightlife", "Outdoors", "Culture", "Wellness", "Shopping"];
  const perCategoryTarget = Math.max(75, Math.floor(limit / categories.length));
  const selected = [];
  const selectedIds = new Set();

  for (const category of categories) {
    const categorySpots = sorted
      .filter((spot) => spot.category === category)
      .slice(0, perCategoryTarget);

    for (const spot of categorySpots) {
      selected.push(spot);
      selectedIds.add(spot.id);
    }
  }

  for (const spot of sorted) {
    if (selected.length >= limit) {
      break;
    }

    if (!selectedIds.has(spot.id)) {
      selected.push(spot);
      selectedIds.add(spot.id);
    }
  }

  return selected.slice(0, limit).sort(rank);
}

export function buildDataset(elements, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const limit = Number(options.limit || process.env.SPOT_LIMIT || 1500);
  const query = options.query || buildOverpassQuery();
  const spots = dedupeAndRank(
    elements.map((element) => normalizeElement(element, generatedAt)).filter(Boolean),
    limit,
  );

  return {
    schemaVersion: 1,
    generatedAt,
    source: {
      name: "OpenStreetMap via Overpass API",
      endpoint: OVERPASS_ENDPOINT,
      queryHash: hashQuery(query),
      attribution: "© OpenStreetMap contributors",
      license: "ODbL",
    },
    coverage: {
      name: "San Francisco Bay Area",
      bbox: BAY_AREA_BBOX,
      boxes: BAY_AREA_BOXES,
    },
    count: spots.length,
    spots,
  };
}

export function validateDataset(dataset, options = {}) {
  const minSpots = Number(options.minSpots ?? 1);
  const errors = [];

  if (!dataset || typeof dataset !== "object") {
    return ["Dataset must be an object."];
  }

  if (!Array.isArray(dataset.spots)) {
    errors.push("Dataset spots must be an array.");
    return errors;
  }

  if (dataset.spots.length < minSpots) {
    errors.push(`Dataset has ${dataset.spots.length} spots, expected at least ${minSpots}.`);
  }

  const ids = new Set();
  for (const [index, spot] of dataset.spots.entries()) {
    const prefix = `spots[${index}]`;

    for (const field of ["id", "name", "category", "neighborhood", "sourceUrl", "imageUrl"]) {
      if (!spot[field] || typeof spot[field] !== "string") {
        errors.push(`${prefix}.${field} is required.`);
      }
    }

    if (spot.imageUrl && !sanitizeUrl(spot.imageUrl)) {
      errors.push(`${prefix}.imageUrl must be an http or https URL.`);
    }

    if (ids.has(spot.id)) {
      errors.push(`${prefix}.id is duplicated.`);
    }
    ids.add(spot.id);

    if (!Number.isFinite(spot.lat) || !Number.isFinite(spot.lon)) {
      errors.push(`${prefix} must have numeric coordinates.`);
    } else if (!isInBayArea(spot.lat, spot.lon)) {
      errors.push(`${prefix} coordinates are outside Bay Area coverage.`);
    }

    const serialized = JSON.stringify(spot);
    if (/<script/i.test(serialized) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(serialized)) {
      errors.push(`${prefix} contains unsafe text.`);
    }
  }

  return errors;
}
