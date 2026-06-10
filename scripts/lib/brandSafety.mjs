// Brand-safety blocklist for spot datasets. The kids (FamHop) feed must never
// surface weapons venues (gun ranges, tactical shops), cannabis/smoke/vape
// shops, or adult entertainment. The adults (Mosey) feed may keep bars,
// hookah lounges, etc., but weapons venues are dropped there too.
//
// Matching is intentionally conservative to avoid false positives like the
// "Target" store, "Smokehouse BBQ", or "The Smoke Shop BBQ" (a restaurant):
// name patterns require weapon/cannabis-specific words, and generic words
// like "range", "smoke", or "shooting" alone never match — they must appear
// in a venue-shaped phrase ("gun range", "shooting range") or as an explicit
// OSM-derived tag value ("weapons", "cannabis").

const WEAPONS_NAME_PATTERNS = [
  /\bgun\s?(?:range|ranges|shop|store|club|show)\b/i,
  /\bshooting\s?(?:range|ranges|center|centre|sports|club|gallery|complex)\b/i,
  /\bsports\s?range\b/i, // "Eagle Sports Range" — gun ranges brand as "sports"
  /\brange\s?usa\b/i, // national gun-range chain; OSM tags it sports_centre
  /\btactical\b/i,
  /\bfirearms?\b/i,
  /\bammo\b/i,
  /\bammunition\b/i,
];

const CANNABIS_NAME_PATTERNS = [
  /\bcannabis\b/i,
  /\bdispensar(?:y|ies)\b/i,
  /\bmarijuana\b/i,
  /\bhookah\b/i,
  /\bvape\b/i,
  /\bhead\s?shop\b/i,
];

const ADULT_NAME_PATTERNS = [
  /\bstrip\s?club\b/i,
  /\bgentlemen'?s\s?club\b/i,
  /\badult\s?(?:entertainment|video|store|bookstore|theater|theatre|toys?)\b/i,
  /\bsex\s?shop\b/i,
];

// Exact tag/category values (lowercased) from OSM-derived friendly tags,
// e.g. shop=weapons -> "weapons", shop=cannabis -> "cannabis".
const WEAPONS_TAG_VALUES = new Set(["weapons", "guns", "firearms", "shooting"]);
const CANNABIS_TAG_VALUES = new Set(["cannabis", "hookah", "vape", "e-cigarette", "tobacco"]);
const ADULT_TAG_VALUES = new Set(["stripclub", "brothel", "erotic", "adult_gaming_centre"]);

function spotTagValues(spot) {
  return (Array.isArray(spot?.tags) ? spot.tags : [])
    .map((tag) => String(tag || "").toLowerCase().trim())
    .filter(Boolean);
}

// Returns "weapons" | "cannabis" | "adult" | null for a spot-shaped object
// ({ name, tags, category }).
export function brandSafetyViolation(spot) {
  if (!spot) return null;
  const name = String(spot.name || "");
  const tags = spotTagValues(spot);
  if (WEAPONS_NAME_PATTERNS.some((re) => re.test(name)) || tags.some((tag) => WEAPONS_TAG_VALUES.has(tag))) {
    return "weapons";
  }
  if (CANNABIS_NAME_PATTERNS.some((re) => re.test(name)) || tags.some((tag) => CANNABIS_TAG_VALUES.has(tag))) {
    return "cannabis";
  }
  if (ADULT_NAME_PATTERNS.some((re) => re.test(name)) || tags.some((tag) => ADULT_TAG_VALUES.has(tag))) {
    return "adult";
  }
  return null;
}

export function isBrandSafeForKids(spot) {
  return brandSafetyViolation(spot) === null;
}

// Adults keep bars, hookah lounges, etc. — only weapons venues are dropped.
export function isBrandSafeForAdults(spot) {
  return brandSafetyViolation(spot) !== "weapons";
}
