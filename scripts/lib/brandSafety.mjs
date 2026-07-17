// Brand-safety taxonomy v2 for spot (and event-venue) datasets. The kids
// (FamHop) feed must never surface weapons, cannabis retail, gambling,
// alcohol-primary, adult-entertainment, or age-gated (21+/hookah/cigar/vape
// lounge) venues. The adults (Mosey) feed keeps bars, breweries, casinos,
// hookah/cigar lounges, and adult-entertainment venues — only weapons and
// cannabis retail are dropped there too.
//
// Matching is intentionally conservative to avoid false positives like the
// "Target" store, "Smokehouse BBQ", "Range Cafe", or "Movie Tavern": name
// patterns require venue-shaped phrases ("gun range", "smoke shop"), and
// generic words like "range", "smoke", "tavern", or "bar" alone never match.
// Two data-file overrides sit ahead of every pattern: an allowlist for named
// false positives, and a denylist for offenders that evade every pattern
// (cutely-named dispensaries, casino/strip-club brands with no keyword).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(__dirname, "..", "..", "data");

function loadEntries(filename) {
  try {
    const raw = fs.readFileSync(path.join(DATA_DIR, filename), "utf8");
    const doc = JSON.parse(raw);
    return Array.isArray(doc.entries) ? doc.entries : [];
  } catch {
    return [];
  }
}

const ALLOWLIST = loadEntries("brand-safety-allowlist.json");
const DENYLIST = loadEntries("brand-safety-denylist.json");

function normalizeName(name) {
  return String(name || "").trim().toLowerCase();
}

// Allowlist/denylist entries match by substring (case-insensitive) on the
// spot name, optionally scoped to a metro id. Substring matching is
// deliberate: chains ("Movie Tavern Phoenix") and id-less fixtures both need
// to hit the same seed entry.
function findEntry(list, spot) {
  const name = normalizeName(spot?.name);
  if (!name) return null;
  const metro = spot?.metro ? String(spot.metro).toLowerCase() : null;
  return (
    list.find((entry) => {
      if (entry.metro && metro && String(entry.metro).toLowerCase() !== metro) return false;
      const entryName = normalizeName(entry.name);
      return entryName && name.includes(entryName);
    }) || null
  );
}

export function matchesBrandSafetyAllowlist(spot) {
  return Boolean(findEntry(ALLOWLIST, spot));
}

const WEAPONS_NAME_PATTERNS = [
  /\bgun\s?(?:range|ranges|shop|store|club|show)\b/i,
  /\bshooting\s?(?:range|ranges|center|centre|sports|club|gallery|complex)\b/i,
  /\bsports\s?range\b/i, // "Eagle Sports Range" — gun ranges brand as "sports"
  /\brange\s?usa\b/i, // national gun-range chain; OSM tags it sports_centre
  /\btactical\b/i,
  /\bfirearms?\b/i,
  /\bammo\b/i,
  /\bammunition\b/i,
  /\brod\s?(?:&|and)\s?gun\b/i,
  /\bgun\s?works\b/i,
  /\bshooters?\s?(?:range|supply|world)\b/i,
  /\bindoor\s?range\b/i,
  /\b2nd\s?amendment\b|\bsecond\s?amendment\b/i,
];

// Bare "gun(s)" is too common a substring-adjacent word to match on its own
// (Gunston Park, Gunzo's, Shogun) — it only counts in a Shopping-category
// venue or alongside gear/ammo/arms-shop wording.
const WEAPONS_BARE_GUN_RE = /\bguns?\b/i;
const WEAPONS_GUN_ADJACENT_RE = /\b(?:gear|ammo|arms|armory|outfitters|pawn)\b/i;

const CANNABIS_NAME_PATTERNS = [
  /\bcannabis\b/i,
  /\bdispensar(?:y|ies)\b/i,
  /\bmarijuana\b/i,
  /\bhookah\b/i,
  /\bvape\b/i,
  /\bhead\s?shop\b/i,
  /\bsmoke\s?shop\b/i,
  /\bcbd\b/i,
  /\b420\b/i,
  /\bpot\s?shop\b/i,
  /\bcigars?\b/i,
  /\btobacco\b/i,
];

const GAMBLING_NAME_PATTERNS = [
  /\bcasinos?\b/i,
  /\bcard\s?(?:room|club)\b/i,
  /\bsportsbook\b/i,
  /\bbingo\s?(?:hall|palace)\b/i,
  /\boff[- ]track\s?betting\b/i,
];

const ALCOHOL_NAME_PATTERNS = [
  /\bnight\s?club\b|\bnightclub\b/i,
  /\bbrewer(?:y|ies)\b|\bbrewpub\b|\btap\s?(?:room|house)\b/i,
  /\bwiner(?:y|ies)\b/i,
  /\bdistiller(?:y|ies)\b/i,
  /\bsaloon\b/i,
  /\bspeakeasy\b/i,
  /\bwine\s?bar\b/i,
  /\bcocktail\b/i,
  /\bliquor\b/i,
  /\bbeer\s?garden\b|\bbiergarten\b/i,
  /\bdive\s?bar\b/i,
  /\bsports\s?bar\b/i,
  /\bhappy\s?hour\b/i,
];

// Deliberately NOT matched by name (v1 + v2 policy): bare `\bbar\b` (Oyster
// Bar, juice bar, snack bar), bare `tavern` (overwhelmingly family
// restaurants), bare `smokehouse`/`smokery`, bare `armory` (Park Avenue
// Armory is a cultural venue), `pub` only via tags. Tag/type signals (tier 3)
// are the catch for true bars/pubs.

const ADULT_NAME_PATTERNS = [
  /\bstrip\s?club\b/i,
  /\bgentlemen'?s\s?club\b/i,
  /\badult\s?(?:entertainment|video|store|bookstore|theater|theatre|toys?)\b/i,
  /\bsex\s?shop\b/i,
  /\bburlesque\b/i,
  /\bhostess\s?club\b/i,
];
// "Cabaret" alone is ambiguous (cabaret theaters exist) — only counts with a
// tag confirmation or an explicit 21+/age-gate mention.
const ADULT_CABARET_RE = /\bcabaret\b/i;

const AGE_GATED_LOUNGE_NAME_PATTERNS = [
  /\bhookah\s?loung/i,
  /\bcigar\s?(?:bar|lounge)\b/i,
  /\bvape\s?lounge\b/i,
];

const AGE_GATE_TEXT_RE = /\b21\s?\+|\bmust be 21\b|\bages?\s?21\b/i;

// Exact tag/category values (lowercased) from OSM-derived friendly tags,
// e.g. shop=weapons -> "weapons", shop=cannabis -> "cannabis".
const WEAPONS_TAG_VALUES = new Set(["weapons", "guns", "firearms", "shooting", "hunting", "gun_shop"]);
const CANNABIS_TAG_VALUES = new Set([
  "cannabis",
  "hookah",
  "vape",
  "e-cigarette",
  "tobacco",
  "cannabis_store",
  "smoke_shop",
  "cbd",
]);
const GAMBLING_TAG_VALUES = new Set([
  "casino",
  "gambling",
  "adult_gaming_centre",
  "betting",
  "bookmaker",
  "card_room",
]);
const ALCOHOL_TAG_VALUES = new Set([
  "bar",
  "pub",
  "nightclub",
  "biergarten",
  "brewery",
  "winery",
  "distillery",
  "wine",
  "alcohol",
  "liquor_store",
]);
const ADULT_TAG_VALUES = new Set(["stripclub", "brothel", "erotic"]);

function spotTagValues(spot) {
  return (Array.isArray(spot?.tags) ? spot.tags : [])
    .map((tag) => String(tag || "").toLowerCase().trim())
    .filter(Boolean);
}

function spotText(spot) {
  return [spot?.name, spot?.description, spot?.note].filter(Boolean).join(" ");
}

// Returns "weapons" | "cannabis" | "gambling" | "alcohol" | "adult" |
// "age_gated" | null for a spot-shaped object ({ name, tags, category,
// description?, metro? }).
export function brandSafetyViolation(spot) {
  if (!spot) return null;

  // Tier 1: allowlist short-circuits to safe.
  if (matchesBrandSafetyAllowlist(spot)) return null;

  // Tier 2: denylist forces a class.
  const denied = findEntry(DENYLIST, spot);
  if (denied?.class) return denied.class;

  const name = String(spot.name || "");
  const tags = spotTagValues(spot);

  // Tier 3: OSM tags[] signals (authoritative, low false-positive). Spots
  // are OSM-only — there is no googleType field to check.
  if (tags.some((tag) => WEAPONS_TAG_VALUES.has(tag))) return "weapons";
  if (tags.some((tag) => GAMBLING_TAG_VALUES.has(tag))) return "gambling";
  if (tags.some((tag) => ALCOHOL_TAG_VALUES.has(tag))) return "alcohol";
  if (tags.some((tag) => ADULT_TAG_VALUES.has(tag))) return "adult";
  if (tags.some((tag) => CANNABIS_TAG_VALUES.has(tag))) return "cannabis";

  // Tier 4: name patterns (conservative). Lounges are checked ahead of the
  // generic cannabis word list so "Hookah Lounge" lands in age_gated (kept
  // for adults) instead of cannabis (blocked for adults too).
  if (WEAPONS_NAME_PATTERNS.some((re) => re.test(name))) return "weapons";
  if (WEAPONS_BARE_GUN_RE.test(name) && (spot.category === "Shopping" || WEAPONS_GUN_ADJACENT_RE.test(name))) {
    return "weapons";
  }
  if (AGE_GATED_LOUNGE_NAME_PATTERNS.some((re) => re.test(name))) return "age_gated";
  if (GAMBLING_NAME_PATTERNS.some((re) => re.test(name))) return "gambling";
  if (ALCOHOL_NAME_PATTERNS.some((re) => re.test(name))) return "alcohol";
  if (ADULT_NAME_PATTERNS.some((re) => re.test(name))) return "adult";
  if (ADULT_CABARET_RE.test(name) && (tags.includes("cabaret") || AGE_GATE_TEXT_RE.test(spotText(spot)))) {
    return "adult";
  }
  if (CANNABIS_NAME_PATTERNS.some((re) => re.test(name))) return "cannabis";

  // Tier 5: age-gate text (name or description).
  if (AGE_GATE_TEXT_RE.test(spotText(spot))) return "age_gated";

  return null;
}

export function isBrandSafeForKids(spot) {
  return brandSafetyViolation(spot) === null;
}

// Adults keep alcohol, gambling, age_gated (incl. hookah/cigar/vape lounges),
// and adult-entertainment venues — only weapons and cannabis retail drop.
export function isBrandSafeForAdults(spot) {
  const violation = brandSafetyViolation(spot);
  return violation !== "weapons" && violation !== "cannabis";
}

// D2: kids-primary venues (playgrounds, children's museums/gyms) must not
// surface on the adults (Mosey) feed even though they carry no brand-safety
// violation. Allowlist entries (e.g. Walt Disney Family Museum) are honored
// the same way as the taxonomy gate above.
const KIDS_PRIMARY_NAME_PATTERNS = [
  /\bplayground\b/i,
  /\btot\s?lot\b/i,
  /\bsplash\s?pad\b/i,
  /(?:children'?s?|kids?)\b.*\b(?:museum|discovery|play|gym)\b/i,
  /\bthe\s?little\s?gym\b/i,
  /\bmy\s?gym\b/i,
  /\bkidzania\b/i,
  /\bkidspace\b/i,
];

export function isKidsPrimaryVenue(spot) {
  if (!spot) return false;
  if (matchesBrandSafetyAllowlist(spot)) return false;
  const name = String(spot.name || "");
  const tags = spotTagValues(spot);
  // The OSM "playground" tag on a Food-category venue almost always means
  // "has an attached play area" (McDonald's PlayPlace), not "is a
  // playground" — only trust the bare tag outside that category.
  if (tags.includes("playground") && spot.category !== "Food") return true;
  return KIDS_PRIMARY_NAME_PATTERNS.some((re) => re.test(name));
}
