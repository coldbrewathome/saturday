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
// Two data-file overrides sit ahead of most tiers: an allowlist for named
// false positives (exact name match, or `match:"prefix"` for chains whose
// shipped names carry a city suffix), and a denylist for offenders that
// evade every pattern (cutely-named dispensaries, casino/strip-club brands
// with no keyword). Both support an optional `metro` scope. Hard, low-false-
// positive OSM tag signals (weapons, cannabis retail, strip club, gambling)
// are checked BEFORE the allowlist — a name collision with an allowlist seed
// must never rescue a venue that OSM authoritatively tags as one of those.

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

// Feed text routinely carries curly quotes (the spec itself writes
// "(Kids' Show)" with a U+2019) — normalize before any pattern match or
// exact-name comparison so a curly vs. straight apostrophe is never the
// difference between caught and missed.
function normalizeQuotes(value) {
  return String(value || "").replace(/[‘’‛′]/g, "'");
}

function normalizeName(name) {
  return normalizeQuotes(String(name || "")).trim().toLowerCase();
}

// Allowlist/denylist entries match by EXACT normalized name (case-
// insensitive, apostrophe-normalized) by default; an entry with
// `match: "prefix"` matches a chain's location-suffixed shipped names (e.g.
// "Movie Tavern" -> "Movie Tavern Phoenix"). `entry.metro` scopes a match to
// one metro id — the check only ever applies when the probe itself carries
// a `metro` (callers must thread it through; without one, a metro-scoped
// entry never fires, rather than silently applying everywhere).
// `field` lets callers point the match at something other than `spot.name`
// (events use `allowlistName` = venue only, never venue+title).
function findEntry(list, spot, field = "name") {
  const raw = field === "allowlistName" ? (spot?.allowlistName ?? spot?.name) : spot?.name;
  const name = normalizeName(raw);
  if (!name) return null;
  const metro = spot?.metro ? String(spot.metro).toLowerCase().trim() : null;
  return (
    list.find((entry) => {
      if (entry.metro) {
        if (!metro || String(entry.metro).toLowerCase().trim() !== metro) return false;
      }
      const entryName = normalizeName(entry.name);
      if (!entryName) return false;
      return entry.match === "prefix" ? name.startsWith(entryName) : name === entryName;
    }) || null
  );
}

// Events must match the allowlist against the venue only — never a
// venue+title concatenation, where an allowlisted word appearing anywhere in
// a scraped title would otherwise disable the whole gate for that event.
export function matchesBrandSafetyAllowlist(spot) {
  return Boolean(findEntry(ALLOWLIST, spot, "allowlistName"));
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
  // Bare "gun(s)" blocks regardless of category — a miscategorized gun store
  // must not pass. Real false positives (Gunston Park, Gunzo's, Shogun,
  // False Gun Vista) are compound words or protected by the exact-match
  // allowlist, not by a category condition.
  /\bguns?\b/i,
];

const CANNABIS_NAME_PATTERNS = [
  /\bcannabis\b/i,
  /\bdispensar(?:y|ies)\b/i,
  /\bmarijuana\b/i,
  /\bvape\b/i,
  /\bhead\s?shop\b/i,
  /\bsmoke\s?shop\b/i,
  /\bcbd\b/i,
  /\b420\b/i,
  /\bpot\s?shop\b/i,
  /\bcigars?\b/i,
  /\btobacco\b/i,
];

// Gambling's card-room pattern must not fire on trading-card contexts
// (Pokémon/Magic clubs are a staple library kids-event type) — excluded
// when "card" is immediately preceded by one of these words.
const GAMBLING_CARD_ROOM_RE =
  /\b(?<!trading\s)(?<!pokemon\s)(?<!pokémon\s)(?<!game\s)(?<!board\s)(?<!gathering\s)card\s?(?:room|club)\b/i;

const GAMBLING_NAME_PATTERNS = [
  /\bcasinos?\b/i,
  /\bsportsbook\b/i,
  /\bbingo\s?(?:hall|palace)\b/i,
  /\boff[- ]track\s?betting\b/i,
];

const ALCOHOL_NAME_PATTERNS = [
  /\bnight\s?club\b|\bnightclub\b/i,
  /\bbrewer(?:y|ies)\b|\bbrewpub\b|\btap\s?(?:room|house)\b/i,
  /\bwiner(?:y|ies)\b/i,
  /\bdistiller(?:y|ies)\b|\bdistilling\b/i,
  /\bsaloon\b/i,
  /\bspeakeasy\b/i,
  /\bwine\s?bar\b/i,
  /\bcocktail\b/i,
  /\bliquors?\b/i,
  /\bbeer\s?garden\b|\bbiergarten\b/i,
  /\bdive\s?bar\b/i,
  /\bsports\s?bar\b/i,
  /\bhappy\s?hour\b/i,
  /\bbrewing\b/i,
  /\bbeer\s?(?:co\b|hall|works)\b/i,
  /\bales\b/i,
  /\bcellars?\b/i,
  /\bpour\s?house\b/i,
  /\brum\s?bar\b/i,
  /\bbottle\s?shop\b/i,
  /\bgrowler\b/i,
  /\bmeadery\b/i,
  /\bcidery\b/i,
];

// "Vineyard(s)" is also a common nondenominational church-movement name
// ("Vineyard Christian Fellowship") — only counts as alcohol when the name
// doesn't also carry a church-context word.
const VINEYARD_RE = /\bvineyards?\b/i;
const VINEYARD_CHURCH_GUARD_RE = /\b(?:church|christian|fellowship)\b/i;

// Deliberately NOT matched by name (v1 + v2 policy): bare `\bbar\b` (Oyster
// Bar, juice bar, snack bar), bare `tavern` (overwhelmingly family
// restaurants), bare `smokehouse`/`smokery`, bare `armory` (Park Avenue
// Armory is a cultural venue), `pub` only via tags. Tag/type signals (tier 3)
// are the catch for true bars/pubs.

const ADULT_NAME_PATTERNS = [
  /\bstrip\s?club\b/i,
  /\bgentlem[ae]n'?s\s?club\b/i,
  /\badult\s?(?:entertainment|video|store|bookstore|theater|theatre|toys?)\b/i,
  /\bsex\s?shop\b/i,
  /\bburlesque\b/i,
  /\bhostess\s?club\b/i,
  /\bshowgirls?\b/i,
];
// "Cabaret" alone is ambiguous (cabaret theaters exist) — only counts with a
// tag confirmation or an explicit 21+/age-gate mention.
const ADULT_CABARET_RE = /\bcabaret\b/i;

// Hookah venues (with or without "lounge" in the name) are age_gated, not
// cannabis — adults keep them (spec A1); only kids are blocked.
const AGE_GATED_NAME_PATTERNS = [
  /\bhookah\b/i,
  /\bcigar\s?(?:bar|lounge)\b/i,
  /\bvape\s?lounge\b/i,
];

// Matches 21+/18+ in its common phrasings, but never when it's actually a
// price ("$21+", "Tickets $18+") or another number ("121+") — a lookbehind
// excludes anything immediately preceded by "$" or a digit. Bare "ages 21"
// stays 21-only (not "ages 18") — kids-event descriptions routinely say
// "ages 18-36 months" or "Ages 18 months", and matching bare "ages 18" on
// its own (with no "+"/"and up"/"and older" following) turned every toddler
// program in the feed into an age_gated false positive.
const AGE_GATE_TEXT_RE =
  /(?<![$\d])\b(?:21|18)(?:\s?\+|\s+and\s+over|\s+and\s+up|\s?&\s?up|\s+and\s+older)\b|\bmust be (?:21|18)\b|\bages?\s?21\b/i;

// Exact tag/category values (lowercased) from OSM-derived friendly tags,
// e.g. shop=weapons -> "weapons", shop=cannabis -> "cannabis". Multi-value
// OSM tags (shop=alcohol;convenience) are split on ";" by spotTagValues
// below, so each value is checked independently.
const WEAPONS_TAG_VALUES = new Set(["weapons", "guns", "firearms", "shooting", "hunting", "gun_shop"]);
const CANNABIS_TAG_VALUES = new Set([
  "cannabis",
  "vape",
  "e-cigarette",
  "tobacco",
  "cannabis_store",
  "smoke_shop",
  "cbd",
]);
const AGE_GATED_TAG_VALUES = new Set(["hookah", "hookah_lounge"]);
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
const ADULT_TAG_VALUES = new Set(["stripclub", "brothel", "erotic", "swingerclub"]);

function spotTagValues(spot) {
  return (Array.isArray(spot?.tags) ? spot.tags : [])
    // OSM multi-value tags are semicolon-separated (shop=alcohol;convenience);
    // split defensively here even though extractFriendlyTags also splits at
    // the source, so any path that stores a raw multi-value tag is covered.
    .flatMap((tag) => String(tag || "").split(";"))
    .map((tag) => tag.toLowerCase().trim())
    .filter(Boolean);
}

function spotText(spot) {
  return [spot?.name, spot?.description, spot?.note].filter(Boolean).join(" ");
}

// Returns "weapons" | "cannabis" | "gambling" | "alcohol" | "adult" |
// "age_gated" | null for a spot-shaped object ({ name, tags, category,
// description?, metro?, allowlistName? }).
export function brandSafetyViolation(spot) {
  if (!spot) return null;

  const tags = spotTagValues(spot);

  // Hard, low-false-positive OSM tag signals outrank the allowlist — a name
  // collision with an allowlist seed must never rescue a venue that's
  // authoritatively tagged weapons/cannabis-retail/strip-club/gambling.
  if (tags.some((t) => WEAPONS_TAG_VALUES.has(t))) return "weapons";
  if (tags.some((t) => CANNABIS_TAG_VALUES.has(t))) return "cannabis";
  if (tags.some((t) => ADULT_TAG_VALUES.has(t))) return "adult";
  if (tags.some((t) => GAMBLING_TAG_VALUES.has(t))) return "gambling";

  // Tier 1: allowlist short-circuits to safe (only reached when no hard tag
  // fired above).
  if (matchesBrandSafetyAllowlist(spot)) return null;

  // Tier 2: denylist forces a class.
  const denied = findEntry(DENYLIST, spot);
  if (denied?.class) return denied.class;

  // Tier 3: remaining (softer) tag signals.
  if (tags.some((t) => ALCOHOL_TAG_VALUES.has(t))) return "alcohol";
  if (tags.some((t) => AGE_GATED_TAG_VALUES.has(t))) return "age_gated";

  const name = normalizeQuotes(String(spot.name || ""));

  // Tier 4: name patterns (conservative). Age-gated lounges are checked
  // ahead of the generic cannabis/gambling/alcohol word lists.
  if (WEAPONS_NAME_PATTERNS.some((re) => re.test(name))) return "weapons";
  if (AGE_GATED_NAME_PATTERNS.some((re) => re.test(name))) return "age_gated";
  if (GAMBLING_CARD_ROOM_RE.test(name) || GAMBLING_NAME_PATTERNS.some((re) => re.test(name))) {
    return "gambling";
  }
  if (VINEYARD_RE.test(name) && !VINEYARD_CHURCH_GUARD_RE.test(name)) return "alcohol";
  if (ALCOHOL_NAME_PATTERNS.some((re) => re.test(name))) return "alcohol";
  if (ADULT_NAME_PATTERNS.some((re) => re.test(name))) return "adult";
  if (ADULT_CABARET_RE.test(name) && (tags.includes("cabaret") || AGE_GATE_TEXT_RE.test(spotText(spot)))) {
    return "adult";
  }
  if (CANNABIS_NAME_PATTERNS.some((re) => re.test(name))) return "cannabis";

  // Tier 5: age-gate text (name or description).
  if (AGE_GATE_TEXT_RE.test(normalizeQuotes(spotText(spot)))) return "age_gated";

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
  /\bfairyland\b/i,
  /\blegoland\s?discovery\b/i,
  /\bchuck\s?e\.?\s?cheese\b/i,
  /\bjunior\s?museum\b/i,
];

export function isKidsPrimaryVenue(spot) {
  if (!spot) return false;
  if (matchesBrandSafetyAllowlist(spot)) return false;
  const name = normalizeQuotes(String(spot.name || ""));
  const tags = spotTagValues(spot);
  // The OSM "playground" tag on a Food-category venue almost always means
  // "has an attached play area" (McDonald's PlayPlace), not "is a
  // playground" — only trust the bare tag outside that category.
  if (tags.includes("playground") && spot.category !== "Food") return true;
  return KIDS_PRIMARY_NAME_PATTERNS.some((re) => re.test(name));
}
