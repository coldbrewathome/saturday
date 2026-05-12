import crypto from "node:crypto";

export const DEFAULT_TIMEZONE = "America/Los_Angeles";
export const DEFAULT_TIMEZONE_OFFSET = "-07:00";
export const DEFAULT_WINDOW_DAYS = 45;

const TIME_WINDOW_START = {
  Morning: "10:00",
  Afternoon: "14:00",
  Evening: "18:00",
};

const EVENT_TERMS = [
  "activity",
  "animal",
  "baby",
  "children",
  "craft",
  "celebration",
  "concert",
  "dance",
  "demo",
  "event",
  "family",
  "festival",
  "market",
  "kids",
  "lego",
  "maker",
  "music",
  "nature",
  "parade",
  "performance",
  "program",
  "science",
  "story",
  "storytime",
  "toddler",
  "walk",
  "workshop",
];

const FAMILY_TERMS = [
  "all ages",
  "baby",
  "babies",
  "birth to",
  "camp",
  "children",
  "craft",
  "families",
  "family",
  "kids",
  "lego",
  "maker",
  "preschool",
  "preschoolers",
  "school age",
  "school-age",
  "storytime",
  "teen",
  "toddler",
  "toddlers",
  "tween",
  "youth",
];

const ADULT_TERMS = [
  "21+",
  "adult only",
  "adults only",
  "bar crawl",
  "beer garden",
  "brewery",
  "burlesque",
  "cocktail",
  "nightclub",
  "wine tasting",
];

const GENERIC_PAGE_TITLES = [
  /^about\b/i,
  /^contact\b/i,
  /^directions?\b/i,
  /^hours?\b/i,
  /^hours? (and|&) admission\b/i,
  /^mission\b/i,
  /^parking\b/i,
  /^visit\b/i,
  /^events?$/i,
  /^explore activities\b/i,
  /^\d+\s+events?(?:,\s*)?\s+\d+$/i,
  /^(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\s+@\s+\d/i,
  /^open daily from\b/i,
  /^registration for .+ is now closed\b/i,
  /\bmission & history\b/i,
  /\bhours of operation\b/i,
  /\bin progress\b/i,
];

const CATEGORY_BY_TEXT = [
  ["Comedy", /\b(comedy|stand[\s-]?up|improv|comedian)\b/i],
  ["Music", /\b(concert|live music|tour\b|band\b|dj\b|residency|gig|on stage|setlist|opening act)\b/i],
  ["Brewery", /\b(brewery|tap room|tasting room|brewpub|beer release|cask)\b/i],
  ["Festival", /\b(festival|parade|street fair|art & wine|carnaval|pride|night market)\b/i],
  ["Community", /\b(community|open streets|first friday|block party)\b/i],
  ["Library", /\b(library|storytime|book|lego|maker|craft|reading)\b/i],
  ["Zoo", /\b(zoo|animal|wildlife|habitat)\b/i],
  ["Farm", /\b(farm|ranch|garden|harvest|goat|chicken)\b/i],
  ["Park", /\b(park|trail|nature|naturalist|tide|beach|refuge|outdoor)\b/i],
  ["Museum", /\b(museum|science|exhibit|exploratorium|academy|aquarium|discovery)\b/i],
];

const AGE_BANDS = ["toddler", "preschool", "school-age", "tween"];

// City centroid fallback for events whose source provides only a city string
// (e.g. East Bay Regional Parks events spread across Antioch/Sunol/Berkeley/
// Oakland/Fremont). Without this every event falls to the SF default and 100+
// markers stack on top of each other in downtown SF.
const CITY_CENTROIDS = {
  "san francisco": [37.7796, -122.4156],
  oakland: [37.8044, -122.2712],
  berkeley: [37.8715, -122.273],
  alameda: [37.7652, -122.2416],
  emeryville: [37.8313, -122.2852],
  richmond: [37.9358, -122.3477],
  hayward: [37.6688, -122.0808],
  fremont: [37.5485, -121.9886],
  newark: [37.5297, -122.0402],
  "union city": [37.5934, -122.0438],
  "san leandro": [37.7249, -122.156],
  "castro valley": [37.6941, -122.0863],
  pleasanton: [37.6624, -121.8747],
  livermore: [37.6819, -121.768],
  dublin: [37.7022, -121.9358],
  "walnut creek": [37.9101, -122.0652],
  concord: [37.978, -122.0311],
  martinez: [38.0194, -122.1341],
  pittsburg: [38.028, -121.8847],
  antioch: [38.005, -121.8058],
  brentwood: [37.9319, -121.6957],
  oakley: [37.9974, -121.712],
  sunol: [37.5951, -121.8866],
  "bay point": [38.0271, -121.9609],
  clayton: [37.9407, -121.9358],
  "san jose": [37.3382, -121.8863],
  "santa clara": [37.3541, -121.9552],
  sunnyvale: [37.3688, -122.0363],
  "mountain view": [37.3894, -122.0819],
  "palo alto": [37.4419, -122.143],
  stanford: [37.4275, -122.1697],
  "los altos": [37.3852, -122.1141],
  saratoga: [37.2675, -122.0326],
  cupertino: [37.3181, -122.0286],
  campbell: [37.2874, -121.949],
  milpitas: [37.4321, -121.9078],
  "morgan hill": [37.1305, -121.6544],
  gilroy: [37.0046, -121.5663],
  "redwood city": [37.4852, -122.2364],
  "san mateo": [37.5685, -122.3247],
  burlingame: [37.5841, -122.3661],
  "foster city": [37.5585, -122.2711],
  belmont: [37.5202, -122.2758],
  "half moon bay": [37.4636, -122.4286],
  pacifica: [37.6138, -122.4869],
  "south san francisco": [37.6547, -122.4077],
  daly: [37.6879, -122.4702],
  "daly city": [37.6879, -122.4702],
  "san rafael": [37.9735, -122.5311],
  novato: [38.1074, -122.5697],
  mill: [37.906, -122.545],
  "mill valley": [37.906, -122.545],
  sausalito: [37.8591, -122.4853],
  larkspur: [37.9341, -122.5353],
  "muir beach": [37.8624, -122.5735],
  petaluma: [38.2324, -122.6367],
  "santa rosa": [38.4404, -122.7141],
  fairfield: [38.2493, -122.04],
  vallejo: [38.1041, -122.2566],
  vacaville: [38.3566, -121.9877],
};
function lookupCityCentroid(city) {
  if (typeof city !== "string") return null;
  const key = city.trim().toLowerCase();
  return CITY_CENTROIDS[key] || null;
}

export function stripUnsafeText(value, maxLength = 260) {
  if (typeof value !== "string") return "";
  return decodeHtmlEntities(value)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

export function sanitizeUrl(value, baseUrl = "") {
  const raw = stripUnsafeText(value, 700);
  if (!raw) return null;
  try {
    const url = new URL(raw, baseUrl || undefined);
    return ["http:", "https:"].includes(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function decodeHtmlEntities(value) {
  if (typeof value !== "string") return "";
  const named = {
    amp: "&",
    apos: "'",
    gt: ">",
    lt: "<",
    nbsp: " ",
    quot: "\"",
  };
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key[0] === "#") {
      const hex = key.startsWith("#x");
      const code = Number.parseInt(key.slice(hex ? 2 : 1), hex ? 16 : 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    }
    return named[key] ?? match;
  });
}

export function slugify(value) {
  const slug = stripUnsafeText(value, 160)
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  return slug || "event";
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex").slice(0, 10);
}

function dayOfWeek(isoLike) {
  const date = new Date(isoLike);
  return Number.isFinite(date.getTime()) ? date.getDay() : null;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function localIso(date, time = "10:00", timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const [hour = "10", minute = "00"] = time.split(":");
  return `${dateOnly(date)}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00${timezoneOffset}`;
}

function addMinutesToLocalIso(value, minutes) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Date(date.getTime() + minutes * 60_000).toISOString();
}

export function inferTimeWindowFromDate(value, fallback = "Afternoon") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return fallback;
  const hour = date.getHours();
  if (hour < 12) return "Morning";
  if (hour < 17) return "Afternoon";
  return "Evening";
}

export function inferAgeBands(text) {
  const lower = stripUnsafeText(text, 800).toLowerCase();
  const bands = new Set();
  if (/\b(baby|babies|birth to|infant|toddler|toddlers|0-3|0 - 3|ages 0|age 0|lapsit)\b/.test(lower)) {
    bands.add("toddler");
  }
  if (/\b(preschool|preschoolers|pre-schoolers|pre-k|pre k|ages 2-5|ages 3|age 3|ages 4|age 4|ages 5|age 5|0-5|0 - 5|birth to 5)\b/.test(lower)) {
    bands.add("preschool");
  }
  if (/\b(camp|children|kids|kids \(6-11\)|school age|school-age|grades?\s+k|grades?\s+[1-5]|ages 6|ages 7|ages 8|ages 9|ages 10|elementary|lego|maker|craft|youth)\b/.test(lower)) {
    bands.add("school-age");
  }
  if (/\b(tween|tweens|teen|teens|ages 10|ages 11|ages 12|ages 13|middle school|code club)\b/.test(lower)) {
    bands.add("tween");
  }
  if (bands.size === 0 && /\bfamilies|family|all ages|children|kids\b/.test(lower)) {
    bands.add("preschool");
    bands.add("school-age");
  }
  return Array.from(bands).filter((band) => AGE_BANDS.includes(band));
}

export function inferCategory(text, fallback = "Museum") {
  const clean = stripUnsafeText(text, 900);
  for (const [category, pattern] of CATEGORY_BY_TEXT) {
    if (pattern.test(clean)) return category;
  }
  return fallback;
}

export function inferCost(text) {
  const clean = stripUnsafeText(text, 800).toLowerCase();
  if (/\bfree|included with admission|no cost\b/.test(clean)) return "Free";
  if (/\bticket|admission|paid|register|reservation\b/.test(clean)) return "$";
  return "Unknown";
}

export function hasAdultOnlySignal(text) {
  const clean = stripUnsafeText(text, 1000).toLowerCase();
  return ADULT_TERMS.some((term) => clean.includes(term));
}

function maybeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function sourceAudienceText(source = {}) {
  return stripUnsafeText(
    source.defaultAudienceText || source.audienceText || source.eventList?.defaultAudienceText || "",
    500,
  );
}

function walkJsonLd(value, out = []) {
  if (!value || typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) walkJsonLd(item, out);
    return out;
  }
  const type = value["@type"];
  const types = maybeArray(type).map((item) => String(item).toLowerCase());
  if (types.includes("event")) {
    out.push(value);
  }
  for (const key of ["@graph", "itemListElement", "events", "mainEntity"]) {
    if (value[key]) walkJsonLd(value[key], out);
  }
  return out;
}

export function extractJsonLdEvents(html, source = {}) {
  const events = [];
  const re = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  for (const match of html.matchAll(re)) {
    const raw = decodeHtmlEntities(match[1]).trim();
    if (!raw) continue;
    try {
      const parsed = JSON.parse(raw);
      for (const item of walkJsonLd(parsed)) {
        const signalText = `${item.name || ""} ${item.description || ""} ${sourceAudienceText(source)}`;
        events.push(normalizeRawEvent({
          title: item.name,
          description: item.description,
          venue: item.location?.name || source.name,
          city: item.location?.address?.addressLocality || source.city,
          lat: item.location?.geo?.latitude,
          lon: item.location?.geo?.longitude,
          category: source.category || inferCategory(signalText),
          startDateTime: item.startDate,
          endDateTime: item.endDate,
          ageBands: inferAgeBands(signalText),
          url: item.url,
          cost: item.isAccessibleForFree === true ? "Free" : inferCost(signalText),
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          extractionMethod: "json-ld",
          verified: true,
        }, source));
      }
    } catch {
      // Ignore malformed embedded JSON-LD from source pages.
    }
  }
  return events.filter(Boolean);
}

function fieldFromIcs(block, key) {
  const re = new RegExp(`^${key}(?:;[^:]*)?:(.*)$`, "im");
  return stripUnsafeText(block.match(re)?.[1] || "", 1000);
}

function parseIcsDate(value, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const raw = stripUnsafeText(value, 80);
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/);
  if (!compact) return null;
  const [, y, m, d, hh = "10", mm = "00", ss = "00"] = compact;
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${raw.endsWith("Z") ? "Z" : timezoneOffset}`;
}

export function extractIcsEvents(text, source = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks
    .map((block) => normalizeRawEvent({
      title: fieldFromIcs(block, "SUMMARY"),
      description: fieldFromIcs(block, "DESCRIPTION"),
      venue: fieldFromIcs(block, "LOCATION") || source.name,
      city: source.city,
      category: source.category,
      startDateTime: parseIcsDate(fieldFromIcs(block, "DTSTART"), timezoneOffset),
      endDateTime: parseIcsDate(fieldFromIcs(block, "DTEND"), timezoneOffset),
      url: fieldFromIcs(block, "URL") || source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "ics",
    }, source))
    .filter(Boolean);
}

export function extractRssEvents(text, source = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const blocks = text.match(/<item[\s\S]*?<\/item>|<entry[\s\S]*?<\/entry>/gi) || [];
  return blocks
    .map((block) => {
      const tag = (name) => stripUnsafeText(block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, "i"))?.[1] || "", 1000);
      const linkMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i);
      const link = tag("link") || linkMatch?.[1] || source.url;
      const textForDate = `${tag("title")} ${tag("description")} ${tag("summary")} ${tag("pubDate")} ${tag("updated")}`;
      return normalizeRawEvent({
        title: tag("title"),
        description: tag("description") || tag("summary"),
        venue: source.name,
        city: source.city,
        category: source.category,
        startDateTime: parseLooseDate(textForDate, new Date(), timezoneOffset),
        url: link,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        extractionMethod: "rss",
      }, source);
    })
    .filter(Boolean);
}

function pageTitle(html) {
  return stripUnsafeText(
    html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ||
      "",
    180,
  );
}

function pageDescription(html) {
  return stripUnsafeText(
    html.match(/<meta[^>]+(?:name|property)=["'](?:description|og:description)["'][^>]+content=["']([^"']+)["']/i)?.[1] || "",
    300,
  );
}

function hrefsFromBlock(block, baseUrl) {
  const links = [];
  for (const match of block.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const url = sanitizeUrl(match[1], baseUrl);
    const text = stripUnsafeText(match[2], 180);
    if (url && text) links.push({ url, text });
  }
  return links;
}

export function extractHtmlEvents(html, source = {}, options = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const jsonLd = extractJsonLdEvents(html, source);
  const blocks = [
    ...(html.match(/<article[\s\S]*?<\/article>/gi) || []),
    ...(html.match(/<li[\s\S]*?<\/li>/gi) || []),
    ...(html.match(/<div[^>]+(?:class|id)=["'][^"']*(?:event|calendar|program|card)[^"']*["'][^>]*>[\s\S]{0,3500}?<\/div>/gi) || []),
  ].slice(0, 180);

  const extracted = [];
  for (const block of blocks) {
    const text = stripUnsafeText(block, 1400);
    const audienceText = sourceAudienceText(source);
    const signalText = `${text} ${audienceText}`;
    if (!isEventish(signalText) || hasAdultOnlySignal(signalText)) continue;
    if (!hasFamilySignal(signalText)) continue;
    const startDateTime = datetimeFromBlock(block, timezoneOffset) || parseLooseDate(text, options.now || new Date(), timezoneOffset);
    if (!startDateTime) continue;
    const links = hrefsFromBlock(block, source.url);
    const title = bestTitleFromBlock(block, links, text);
    if (!title) continue;
    const ageBands = inferAgeBands(`${title} ${text.slice(0, 500)} ${audienceText}`);
    if (ageBands.length === 0) continue;
    extracted.push(normalizeRawEvent({
      title,
      description: text,
      venue: source.name,
      city: source.city,
      category: source.category || inferCategory(text),
      startDateTime,
      ageBands,
      url: links[0]?.url || source.url,
      cost: inferCost(text),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "html",
    }, source));
  }

  if (jsonLd.length > 0 || extracted.length > 0) {
    return [...jsonLd, ...extracted].filter(Boolean);
  }

  const structured = extractStructuredHtmlEvents(html, source, options);
  if (structured.length > 0) return structured;

  // Last-resort source metadata extraction. This confirms the page is reachable
  // but does not create user-facing events because no dated event was found.
  void pageTitle(html);
  void pageDescription(html);
  return [];
}

function isEventish(text) {
  const lower = stripUnsafeText(text, 1000).toLowerCase();
  return EVENT_TERMS.some((term) => lower.includes(term));
}

function hasFamilySignal(text) {
  const lower = stripUnsafeText(text, 1000).toLowerCase();
  return FAMILY_TERMS.some((term) => lower.includes(term));
}

function bestTitleFromBlock(block, links, fallbackText) {
  const heading =
    block.match(/<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i)?.[1] ||
    links.find((link) => isEventish(link.text))?.text ||
    fallbackText.split(/[.|•]/)[0];
  return stripUnsafeText(heading, 120);
}

function datetimeFromBlock(block, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const timeMatch = block.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);
  return timeMatch ? normalizeDateTime(timeMatch[1], timezoneOffset) : null;
}

export function parseLooseDate(text, now = new Date(), timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const clean = stripUnsafeText(text, 1200);
  const iso = clean.match(/\b(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\b/);
  if (iso) {
    const [, y, m, d, hh = "10", mm = "00", ss = "00"] = iso;
    return `${y}-${m}-${d}T${hh.padStart(2, "0")}:${mm}:${ss}${timezoneOffset}`;
  }

  const month = clean.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan\.?|Feb\.?|Mar\.?|Apr\.?|Jun\.?|Jul\.?|Aug\.?|Sep\.?|Sept\.?|Oct\.?|Nov\.?|Dec\.?)\s+(\d{1,2})(?:,\s*(20\d{2}))?(?:[^0-9]{0,24}(\d{1,2})(?::(\d{2}))?\s*(am|pm))?/i);
  if (!month) return null;
  const monthNames = {
    jan: 0,
    january: 0,
    feb: 1,
    february: 1,
    mar: 2,
    march: 2,
    apr: 3,
    april: 3,
    may: 4,
    jun: 5,
    june: 5,
    jul: 6,
    july: 6,
    aug: 7,
    august: 7,
    sep: 8,
    sept: 8,
    september: 8,
    oct: 9,
    october: 9,
    nov: 10,
    november: 10,
    dec: 11,
    december: 11,
  };
  const key = month[1].replace(/\./g, "").toLowerCase();
  const m = monthNames[key];
  if (m === undefined) return null;
  let year = Number(month[3] || now.getFullYear());
  const day = Number(month[2]);
  let hour = Number(month[4] || 10);
  const minute = Number(month[5] || 0);
  const ampm = (month[6] || "").toLowerCase();
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  let date = new Date(Date.UTC(year, m, day));
  if (date < addDays(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())), -1) && !month[3]) {
    year += 1;
    date = new Date(Date.UTC(year, m, day));
  }
  return `${dateOnly(date)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00${timezoneOffset}`;
}

const MONTH_INDEX = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

const MONTH_PATTERN = "January|February|March|April|May|June|July|August|September|October|November|December|Jan\\.?|Feb\\.?|Mar\\.?|Apr\\.?|Jun\\.?|Jul\\.?|Aug\\.?|Sep\\.?|Sept\\.?|Oct\\.?|Nov\\.?|Dec\\.?";
const CLOCK_PATTERN = "\\d{1,2}(?::\\d{2})?\\s*(?:am|pm)?";

function cleanDateText(value) {
  return stripUnsafeText(value, 1400)
    .replace(/[–—]/g, "-")
    .replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function parseMonthDay(rawDate, now) {
  const clean = cleanDateText(rawDate);
  const match = clean.match(new RegExp(`\\b(${MONTH_PATTERN})\\s+(\\d{1,2})(?:,\\s*(20\\d{2}))?`, "i"));
  if (!match) return null;
  const month = MONTH_INDEX[match[1].replace(/\./g, "").toLowerCase()];
  if (month === undefined) return null;
  let year = Number(match[3] || now.getUTCFullYear());
  const day = Number(match[2]);
  let date = new Date(Date.UTC(year, month, day));
  if (!match[3]) {
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    if (date < addDays(today, -1)) {
      year += 1;
      date = new Date(Date.UTC(year, month, day));
    }
  }
  return date;
}

function parseNumericDate(month, day, year) {
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  return Number.isFinite(date.getTime()) ? date : null;
}

function parseClock(rawTime, fallbackMeridiem = "") {
  const clean = stripUnsafeText(rawTime, 40).toLowerCase().replace(/\s+/g, "");
  const match = clean.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)?$/);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || 0);
  const meridiem = match[3] || fallbackMeridiem;
  if (meridiem === "pm" && hour < 12) hour += 12;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute, meridiem: match[3] || "" };
}

function inferStartMeridiem(startRaw, endRaw) {
  const start = stripUnsafeText(startRaw, 40).toLowerCase().match(/^(\d{1,2})/);
  const end = stripUnsafeText(endRaw, 40).toLowerCase().match(/^(\d{1,2})(?::\d{2})?\s*(am|pm)?$/);
  if (!start || !end?.[2]) return "";
  const startHour = Number(start[1]);
  const endHour = Number(end[1]);
  if (end[2] === "pm" && endHour === 12 && startHour < 12) return "am";
  if (end[2] === "pm" && startHour > endHour && endHour <= 5) return "am";
  return end[2];
}

function localDateTime(date, clock, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  if (!date || !clock) return null;
  return `${dateOnly(date)}T${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}:00${timezoneOffset}`;
}

export function parseDateTimeRange(text, now = new Date(), timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const clean = cleanDateText(text);
  const numeric = clean.match(new RegExp(`\\b(\\d{1,2})/(\\d{1,2})/(20\\d{2})\\s+(${CLOCK_PATTERN})\\s*(?:-|to)\\s*(${CLOCK_PATTERN})`, "i"));
  const monthNamed = clean.match(new RegExp(`(?:\\bon\\s+)?((${MONTH_PATTERN})\\s+\\d{1,2}(?:,\\s*20\\d{2})?)\\s*(?:,|at)?\\s*(${CLOCK_PATTERN})\\s*(?:-|to)\\s*(${CLOCK_PATTERN})`, "i"));
  const match = numeric || monthNamed;
  if (!match) return null;

  const date = numeric ? parseNumericDate(match[1], match[2], match[3]) : parseMonthDay(match[1], now);
  const startRaw = numeric ? match[4] : match[3];
  const endRaw = numeric ? match[5] : match[4];
  const endMeridiem = stripUnsafeText(endRaw, 40).toLowerCase().match(/(am|pm)$/)?.[1] || "";
  const startMeridiem = stripUnsafeText(startRaw, 40).toLowerCase().match(/(am|pm)$/)?.[1] || inferStartMeridiem(startRaw, endRaw);
  const startClock = parseClock(startRaw, startMeridiem);
  const endClock = parseClock(endRaw, endMeridiem || startMeridiem);
  if (!date || !startClock || !endClock) return null;
  return {
    startDateTime: localDateTime(date, startClock, timezoneOffset),
    endDateTime: localDateTime(date, endClock, timezoneOffset),
  };
}

function htmlToLines(html) {
  const marked = decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<h[1-6][^>]*>/gi, "\n### ")
    .replace(/<\/h[1-6]>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(a|article|div|li|p|section|span|td|th|time|tr)>/gi, "\n")
    .replace(/<[^>]*>/g, " ");
  return marked
    .split(/\r?\n/)
    .map((line) => stripUnsafeText(line, 700))
    .filter(Boolean);
}

function isNoiseLine(line) {
  return /^(image|featured events only|options|interested|event actions|learn more|view details|register now|discover|add to calendar|more details|show more|filter|location|date|until|from)$/i.test(line) ||
    /find more events in:/i.test(line) ||
    /view all dates/i.test(line);
}

function titleFromHeading(line) {
  const clean = stripUnsafeText(line.replace(/^#+\s*/, ""), 140);
  if (!clean || isNoiseLine(clean)) return "";
  return cleanEventTitle(clean);
}

function linkForTitle(html, title, baseUrl) {
  const wanted = stripUnsafeText(title, 140).toLowerCase();
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]{0,700}?)<\/a>/gi)) {
    const text = stripUnsafeText(match[2], 180).toLowerCase();
    if (text && (text === wanted || text.includes(wanted))) {
      return sanitizeUrl(match[1], baseUrl);
    }
  }
  return null;
}

function venueFromLines(lines, source) {
  for (const line of lines) {
    const clean = stripUnsafeText(line, 180);
    const location = clean.match(/(?:event\s+)?location:\s*(.+)$/i)?.[1];
    if (location) return stripUnsafeText(location, 100);
  }
  const atLine = lines.find((line) => /\bat\b/i.test(line) && !parseDateTimeRange(line));
  return stripUnsafeText(atLine || source.name, 100);
}

function descriptionFromLines(lines, title, dateLine) {
  return lines
    .filter((line) => {
      const clean = stripUnsafeText(line, 240);
      return clean &&
        clean !== title &&
        clean !== dateLine &&
        !clean.startsWith("###") &&
        !isNoiseLine(clean) &&
        !/^(canceled|cancelled|in progress)$/i.test(clean) &&
        !/(event\s+)?location:/i.test(clean) &&
        !parseDateTimeRange(clean);
    })
    .slice(0, 5)
    .join(" ");
}

function normalizeLineEvent({ title, dateLine, lines, html, source, options, method, fallbackCategory }) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const joined = lines.join(" ");
  if (/cancel(?:ed|led)/i.test(joined)) return null;
  const range = parseDateTimeRange(dateLine || joined, options.now || new Date(), timezoneOffset);
  if (!range) return null;
  const description = descriptionFromLines(lines, title, dateLine);
  const signalText = `${title} ${description} ${joined} ${sourceAudienceText(source)}`;
  if (!isEventish(signalText) || !hasFamilySignal(signalText) || hasAdultOnlySignal(signalText)) return null;
  const ageBands = inferAgeBands(signalText);
  if (ageBands.length === 0) return null;
  return normalizeRawEvent({
    title,
    description: description || joined,
    venue: venueFromLines(lines, source),
    city: source.city,
    category: source.category || fallbackCategory || inferCategory(signalText),
    startDateTime: range.startDateTime,
    endDateTime: range.endDateTime,
    ageBands,
    url: linkForTitle(html, title, source.url) || source.url,
    cost: inferCost(signalText),
    sourceId: source.id,
    sourceName: source.name,
    sourceUrl: source.url,
    extractionMethod: method,
    verified: true,
  }, source);
}

function hasBiblioYouthAudience(lines) {
  return /\b(babies|birth to 5|children|families|grade schoolers|kids|pre-schoolers|preschoolers|toddlers|tweens)\b/i.test(lines.join(" "));
}

export function extractStructuredHtmlEvents(html, source = {}, options = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const lines = htmlToLines(html);
  const events = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].startsWith("###")) continue;
    const title = titleFromHeading(lines[index]);
    if (!title || isGenericPageTitle(title)) continue;
    let end = lines.length;
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      if (lines[cursor].startsWith("###")) {
        end = cursor;
        break;
      }
    }
    const blockLines = lines.slice(index + 1, Math.min(end, index + 28));
    const dateLine = blockLines.find((line) => parseDateTimeRange(line, options.now || new Date(), timezoneOffset));
    if (!dateLine && !parseDateTimeRange(blockLines.join(" "), options.now || new Date(), timezoneOffset)) continue;
    const event = normalizeLineEvent({
      title,
      dateLine,
      lines: blockLines,
      html,
      source,
      options,
      method: source.sourceType || "structured-html",
    });
    if (event) events.push(event);
  }
  return dedupeEvents(events);
}

function eventListOptions(source = {}) {
  return source.eventList || {};
}

function parseDateLineRange(line, source = {}, now = new Date()) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const range = parseDateTimeRange(line, now, timezoneOffset);
  if (range) return range;

  const config = eventListOptions(source);
  const startTime = config.defaultStartTime || source.defaultStartTime;
  if (!startTime) return null;
  const date = parseMonthDay(line, now);
  const startClock = parseClock(startTime);
  if (!date || !startClock) return null;
  const startDateTime = localDateTime(date, startClock, timezoneOffset);
  const endTime = config.defaultEndTime || source.defaultEndTime;
  const endClock = endTime ? parseClock(endTime) : null;
  return {
    startDateTime,
    endDateTime: endClock
      ? localDateTime(date, endClock, timezoneOffset)
      : addMinutesToLocalIso(startDateTime, Number(config.defaultDurationMinutes || source.defaultDurationMinutes || 60)),
  };
}

function isEventListDateLine(line, source = {}, now = new Date()) {
  return Boolean(parseDateLineRange(line, source, now));
}

function titleNearDateLine(lines, dateIndex, source = {}, now = new Date()) {
  const scanForward = lines.slice(dateIndex + 1, Math.min(lines.length, dateIndex + 8));
  for (const line of scanForward) {
    if (isEventListDateLine(line, source, now) || isNoiseLine(line)) continue;
    const title = line.startsWith("###") ? titleFromHeading(line) : cleanEventTitle(line);
    if (title && !isGenericPageTitle(title) && !parseMonthDay(title, now)) return title;
  }

  const scanBackward = lines.slice(Math.max(0, dateIndex - 4), dateIndex).reverse();
  for (const line of scanBackward) {
    if (isEventListDateLine(line, source, now) || isNoiseLine(line)) continue;
    const title = line.startsWith("###") ? titleFromHeading(line) : cleanEventTitle(line);
    if (title && !isGenericPageTitle(title) && !parseMonthDay(title, now)) return title;
  }
  return "";
}

function eventListBlock(lines, dateIndex, source = {}, now = new Date()) {
  const block = [];
  for (let cursor = dateIndex; cursor < Math.min(lines.length, dateIndex + 20); cursor += 1) {
    if (cursor > dateIndex && isEventListDateLine(lines[cursor], source, now)) break;
    block.push(lines[cursor]);
  }
  return block;
}

export function extractEventListEvents(html, source = {}, options = {}) {
  const lines = htmlToLines(html);
  const now = options.now || new Date();
  const config = eventListOptions(source);
  const events = [...extractJsonLdEvents(html, source)];

  for (let index = 0; index < lines.length; index += 1) {
    const range = parseDateLineRange(lines[index], source, now);
    if (!range) continue;
    const title = titleNearDateLine(lines, index, source, now);
    if (!title || isGenericPageTitle(title)) continue;
    const blockLines = eventListBlock(lines, index, source, now);
    const joined = blockLines.join(" ");
    if (/cancel(?:ed|led)/i.test(joined)) continue;
    const signalText = `${title} ${joined} ${sourceAudienceText(source)}`;
    if (config.requireEventSignal !== false && !isEventish(signalText)) continue;
    if (config.requireFamilySignal !== false && !hasFamilySignal(signalText)) continue;
    if (hasAdultOnlySignal(signalText)) continue;
    const ageBands = inferAgeBands(signalText);
    const event = normalizeRawEvent({
      title,
      description: descriptionFromLines(blockLines, title, lines[index]) || joined,
      venue: config.venue || source.venue || venueFromLines(blockLines, source),
      city: config.city || source.city,
      neighborhood: config.neighborhood || source.neighborhood || source.city,
      lat: config.lat ?? source.lat,
      lon: config.lon ?? source.lon,
      category: config.category || source.category || inferCategory(signalText, "Festival"),
      startDateTime: range.startDateTime,
      endDateTime: range.endDateTime,
      ageBands,
      cost: config.cost || inferCost(signalText),
      url: linkForTitle(html, title, source.url) || source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "event-list",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  return dedupeEvents(events);
}

function blocksByClass(html, classNamePattern) {
  const starts = [];
  const re = new RegExp(`<div[^>]+class=["'][^"']*${classNamePattern}[^"']*["'][^>]*>`, "gi");
  for (const match of html.matchAll(re)) {
    starts.push(match.index);
  }
  return starts.map((start, index) => {
    const end = starts[index + 1] ?? html.length;
    return html.slice(start, end);
  });
}

function firstClassText(block, classNamePattern, maxLength = 180) {
  const match = block.match(
    new RegExp(`<[^>]+class=["'][^"']*${classNamePattern}[^"']*["'][^>]*>([\\s\\S]*?)<\\/[^>]+>`, "i"),
  );
  return stripUnsafeText(match?.[1] || "", maxLength);
}

function firstClassLink(block, classNamePattern, baseUrl) {
  const classBlock = block.match(
    new RegExp(`<[^>]+class=["'][^"']*${classNamePattern}[^"']*["'][^>]*>[\\s\\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"),
  );
  if (!classBlock) return null;
  return {
    url: sanitizeUrl(classBlock[1], baseUrl),
    text: stripUnsafeText(classBlock[2], 180),
  };
}

export function extractLincolnCenterFamilyEvents(html, source = {}, options = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const now = options.now || new Date();
  const blocks = blocksByClass(html, "event-with-image-and-description");
  const events = [];

  for (const block of blocks) {
    const titleLink = firstClassLink(block, "event-title", source.url);
    const title = titleLink?.text;
    if (!title || isGenericPageTitle(title)) continue;
    const dateText =
      firstClassText(block, "event-date-in-details", 100) ||
      firstClassText(block, "event-date", 100);
    const startDateTime = parseLooseDate(dateText, now, timezoneOffset);
    if (!startDateTime) continue;
    const venueLink = firstClassLink(block, "venue-info", source.url);
    const iconText = Array.from(block.matchAll(/show-icons-item-text["'][^>]*>([\s\S]*?)<\/div>/gi))
      .map((match) => stripUnsafeText(match[1], 80))
      .filter(Boolean)
      .join(" ");
    const description = firstClassText(block, "vs-show-short-description", 320);
    const signalText = `${title} ${description} ${iconText} ${sourceAudienceText(source)}`;
    if (!isEventish(signalText) || !hasFamilySignal(signalText) || hasAdultOnlySignal(signalText)) continue;
    const ageBands = inferAgeBands(signalText);
    events.push(normalizeRawEvent({
      title,
      description: description || signalText,
      venue: venueLink?.text || source.name,
      city: source.city,
      neighborhood: source.neighborhood || source.city,
      lat: source.lat,
      lon: source.lon,
      category: source.category || "Theater",
      startDateTime,
      endDateTime: addMinutesToLocalIso(startDateTime, source.defaultDurationMinutes || 90),
      ageBands,
      cost: source.cost || inferCost(signalText),
      url: titleLink?.url || source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "lincoln-center-family",
      verified: true,
    }, source));
  }

  return dedupeEvents(events.filter(Boolean));
}

function eventDetailsText(details) {
  if (!Array.isArray(details)) return "";
  return details
    .map((detail) => `${stripUnsafeText(detail?.title || "", 80)} ${stripUnsafeText(detail?.description_html || "", 220)}`)
    .filter((line) => line.trim())
    .join(" ");
}

function cleanNewVictoryTitle(value) {
  return stripUnsafeText(value, 160)
    .replace(/\s*\|\s*School Performance\s*/i, " ")
    .replace(/\s*\|\s*2025-26 Season\s*/i, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractNewVictoryEvents(json, source = {}) {
  const docs = Array.isArray(json?.docs) ? json.docs : [];
  const events = [];

  for (const item of docs) {
    const event = item?.event || {};
    const custom = item?.attributes?.custom || {};
    const eventCustom = event?.attributes?.custom || {};
    if (eventCustom.hide_from_calendar === true || custom.hide_from_calendar === true) continue;
    if (/school performance/i.test(custom.performance_type || event.title || "")) continue;
    if (/grown[- ]?up nights?/i.test(event.title || "")) continue;
    const title = cleanNewVictoryTitle(event.title || "");
    if (!title) continue;
    const detailsText = eventDetailsText(eventCustom.event_details);
    const keywords = [
      ...(Array.isArray(event?.tessitura?.keywords) ? event.tessitura.keywords : []),
      ...(Array.isArray(item?.tessitura?.keywords) ? item.tessitura.keywords : []),
    ]
      .map((keyword) => stripUnsafeText(keyword?.Description || "", 80))
      .filter(Boolean)
      .join(" ");
    const signalText = `${title} ${detailsText} ${keywords} ${sourceAudienceText(source)}`;
    if (hasAdultOnlySignal(signalText)) continue;
    const venue = stripUnsafeText(event?.venue?.title || source.name, 100);
    events.push(normalizeRawEvent({
      title,
      description: detailsText || keywords || `${title} at ${venue}.`,
      venue,
      city: source.city,
      neighborhood: source.neighborhood || source.city,
      lat: source.lat,
      lon: source.lon,
      category: source.category || "Theater",
      startDateTime: item.startDate,
      endDateTime: item.endDate || addMinutesToLocalIso(item.startDate, source.defaultDurationMinutes || 90),
      ageBands: inferAgeBands(signalText),
      cost: inferCost(signalText),
      url: sanitizeUrl(item.url || event.url || event.slug, source.pageUrl || source.url) || source.pageUrl || source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.pageUrl || source.url,
      extractionMethod: "new-victory-json",
      verified: true,
    }, source));
  }

  return dedupeEvents(events.filter(Boolean));
}

function localIsoFromEpochMillis(value, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const millis = Number(value);
  if (!Number.isFinite(millis)) return null;
  const offsetMatch = String(timezoneOffset).match(/^([+-])(\d{2}):?(\d{2})$/);
  if (!offsetMatch) return new Date(millis).toISOString();
  const sign = offsetMatch[1] === "-" ? -1 : 1;
  const offsetMinutes = sign * (Number(offsetMatch[2]) * 60 + Number(offsetMatch[3]));
  const local = new Date(millis + offsetMinutes * 60_000);
  return `${dateOnly(local)}T${String(local.getUTCHours()).padStart(2, "0")}:${String(local.getUTCMinutes()).padStart(2, "0")}:00${timezoneOffset}`;
}

function extractNycParksLocationJson(html) {
  const match = html.match(/var\s+eventsByLocationJSON\s*=\s*(\[[\s\S]*?\]);\s*\/\/\s*take a list of events/i);
  if (!match) return [];
  try {
    const parsed = JSON.parse(match[1]);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function extractNycParksEvents(html, source = {}, options = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const locations = extractNycParksLocationJson(html);
  if (locations.length === 0) {
    return extractEventListEvents(html, source, options);
  }

  const events = [];
  for (const park of locations) {
    const city = stripUnsafeText(park?.borough || source.city || "New York", 80);
    const parkName = stripUnsafeText(park?.name || source.name || "NYC Parks", 100);
    const lat = Number(park?.lat);
    const lon = Number(park?.lng);
    const locationGroups = Array.isArray(park?.locations) ? park.locations : [];
    for (const location of locationGroups) {
      const locationName = stripUnsafeText(location?.name || "", 100);
      const venue = locationName && locationName !== parkName
        ? `${locationName} at ${parkName}`
        : parkName;
      const eventItems = Array.isArray(location?.events) ? location.events : [];
      for (const item of eventItems) {
        const title = stripUnsafeText(item?.title || "", 140);
        if (!title) continue;
        const startDateTime = localIsoFromEpochMillis(item?.startDate, timezoneOffset);
        if (!startDateTime) continue;
        const endDateTime = localIsoFromEpochMillis(item?.endDate, timezoneOffset);
        const description = stripUnsafeText(
          item?.repetitionString ||
            `${title} at ${venue}${park?.address ? `, ${park.address}` : ""}.`,
          360,
        );
        events.push(normalizeRawEvent({
          title,
          description,
          venue,
          city,
          neighborhood: city,
          lat,
          lon,
          category: source.category || "Park",
          startDateTime,
          endDateTime,
          ageBands: inferAgeBands(`${title} ${description} ${sourceAudienceText(source)}`),
          cost: source.cost || "Free",
          url: item?.link,
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          extractionMethod: "nyc-parks-json",
          verified: true,
        }, source));
      }
    }
  }
  return dedupeEvents(events.filter(Boolean));
}

function normalizeMeridiemText(value) {
  return stripUnsafeText(value, 80)
    .replace(/\ba\.m\./gi, "am")
    .replace(/\bp\.m\./gi, "pm")
    .replace(/\s+/g, " ")
    .trim();
}

function cellTextByClass(row, className, maxLength = 180) {
  const pattern = new RegExp(
    `<td[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/td>`,
    "i",
  );
  return stripUnsafeText(row.match(pattern)?.[1] || "", maxLength);
}

function midpenRowActivity(row) {
  return (
    stripUnsafeText(
      row.match(/views-field-type[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "",
      80,
    ) || cellTextByClass(row, "views-field-type", 80)
  );
}

export function extractMidpenTableEvents(html, source = {}, options = {}) {
  const rows = html.match(/<tr\b[\s\S]*?<\/tr>/gi) || [];
  const now = options.now || new Date();
  const maxMiles = Number(source.maxFamilyMiles || 4.5);
  const durationMinutes = Number(source.defaultDurationMinutes || 120);
  const events = [];

  for (const row of rows) {
    const activity = midpenRowActivity(row);
    if (!/guided activity/i.test(activity)) continue;

    const titleMatch = row.match(
      /views-field-title[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i,
    );
    const title = cleanEventTitle(titleMatch?.[2] || "");
    if (!title || isGenericPageTitle(title)) continue;

    const dateText = stripUnsafeText(
      row.match(/class=["']activity-search-date["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "",
      100,
    );
    const timeText = normalizeMeridiemText(
      row.match(/class=["']activity-search-time["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || "",
    );
    const startDateTime = parseLooseDate(`${dateText} at ${timeText}`, now, source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET);
    if (!startDateTime) continue;

    const preserve = cellTextByClass(row, "views-field-field-preserve-term-1", 120) || source.name;
    const milesText = cellTextByClass(row, "views-field-field-aprox-total-miles", 40);
    const miles = Number.parseFloat(milesText);
    if (Number.isFinite(miles) && miles > maxMiles) continue;

    const subType =
      stripUnsafeText(row.match(/icon-link__name[^>]*>([\s\S]*?)<\/div>/i)?.[1] || "", 80) ||
      stripUnsafeText(row.match(/alt=["']([^"']+)["']/i)?.[1] || "", 80) ||
      "Outdoor activity";
    const signalText = [
      title,
      activity,
      subType,
      preserve,
      sourceAudienceText(source),
    ].join(" ");
    if (!isEventish(signalText) || !hasFamilySignal(signalText) || hasAdultOnlySignal(signalText)) {
      continue;
    }
    const ageBands = inferAgeBands(signalText);
    if (ageBands.length === 0) continue;

    const distanceNote = Number.isFinite(miles) ? ` ${miles} mile route.` : "";
    const event = normalizeRawEvent({
      title,
      description:
        `Guided Midpen open-space ${subType.toLowerCase()} at ${preserve}.${distanceNote} Confirm distance, registration, and age fit on the official listing.`,
      venue: preserve,
      city: source.city,
      neighborhood: preserve,
      lat: source.lat,
      lon: source.lon,
      category: source.category || "Park",
      startDateTime,
      endDateTime: addMinutesToLocalIso(startDateTime, durationMinutes),
      ageBands,
      cost: source.cost || inferCost(signalText),
      url: sanitizeUrl(titleMatch?.[1] || source.url, source.url) || source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "midpen-table",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  return dedupeEvents(events);
}

function searchablePageText(html) {
  return decodeHtmlEntities(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/[\\"]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000_000);
}

function textMatchesPattern(text, pattern) {
  if (!pattern) return true;
  try {
    return new RegExp(pattern, "i").test(text);
  } catch {
    return text.toLowerCase().includes(String(pattern).toLowerCase());
  }
}

function requiredTextMatches(text, required) {
  const items = maybeArray(required);
  return items.every((item) => text.toLowerCase().includes(String(item).toLowerCase()));
}

function officialEventMatchesPage(text, config = {}) {
  if (config.requiredText && !requiredTextMatches(text, config.requiredText)) return false;
  if (config.requiredPattern && !maybeArray(config.requiredPattern).every((pattern) => textMatchesPattern(text, pattern))) {
    return false;
  }
  if (config.requiredAnyPattern && !maybeArray(config.requiredAnyPattern).some((pattern) => textMatchesPattern(text, pattern))) {
    return false;
  }
  return true;
}

function nthWeekdayOfMonth(year, month, dayOfWeek, weekOfMonth) {
  const first = new Date(Date.UTC(year, month, 1));
  const offset = (dayOfWeek - first.getUTCDay() + 7) % 7;
  const day = 1 + offset + (weekOfMonth - 1) * 7;
  const date = new Date(Date.UTC(year, month, day));
  return date.getUTCMonth() === month ? date : null;
}

function expandOfficialRecurringEvents(source = {}, pageText = "", options = {}) {
  const configs = Array.isArray(source.officialRecurringEvents) ? source.officialRecurringEvents : [];
  if (configs.length === 0) return [];
  const now = options.now ? new Date(options.now) : new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = addDays(start, Number(options.windowDays || DEFAULT_WINDOW_DAYS));
  const events = [];

  for (const config of configs) {
    if (!officialEventMatchesPage(pageText, config)) continue;
    const recurrence = config.recurrence || {};
    if (recurrence.frequency !== "monthly") continue;
    const dayOfWeek = Number(recurrence.dayOfWeek);
    const weekOfMonth = Number(recurrence.weekOfMonth || 1);
    for (
      let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
      cursor <= end;
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1))
    ) {
      const date = nthWeekdayOfMonth(cursor.getUTCFullYear(), cursor.getUTCMonth(), dayOfWeek, weekOfMonth);
      if (!date || date < start || date > end) continue;
      const startClock = parseClock(config.startTime || "10:00");
      if (!startClock) continue;
      const startDateTime = localDateTime(date, startClock, source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET);
      const endClock = config.endTime ? parseClock(config.endTime) : null;
      events.push(normalizeRawEvent({
        ...config,
        id: `${config.id || source.id}-${dateOnly(date)}`,
        startDateTime,
        endDateTime: endClock
          ? localDateTime(date, endClock, source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET)
          : addMinutesToLocalIso(startDateTime, Number(config.durationMinutes || 120)),
        city: config.city || source.city,
        neighborhood: config.neighborhood || source.neighborhood || source.city,
        lat: config.lat ?? source.lat,
        lon: config.lon ?? source.lon,
        category: config.category || source.category || "Community",
        url: config.url || source.url,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        extractionMethod: "official-recurring-event",
        verified: true,
      }, source));
    }
  }

  return events.filter(Boolean);
}

export function extractOfficialTextEvents(html, source = {}, options = {}) {
  const pageText = searchablePageText(html);
  const configured = Array.isArray(source.officialTextEvents) ? source.officialTextEvents : [];
  const events = configured
    .filter((config) => officialEventMatchesPage(pageText, config))
    .map((config) => normalizeRawEvent({
      ...config,
      city: config.city || source.city,
      neighborhood: config.neighborhood || source.neighborhood || source.city,
      lat: config.lat ?? source.lat,
      lon: config.lon ?? source.lon,
      category: config.category || source.category || "Festival",
      url: config.url || source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "official-text-event",
      verified: true,
    }, source))
    .filter(Boolean);

  return dedupeEvents([
    ...events,
    ...expandOfficialRecurringEvents(source, pageText, options),
  ]);
}

function openCitiesEventTitle(html, source = {}) {
  return cleanEventTitle(
    html.match(/<h1[^>]*class=["'][^"']*oc-page-title[^"']*["'][^>]*>([\s\S]*?)<\/h1>/i)?.[1] ||
      pageTitle(html).replace(/\s+[-–]\s+City of Palo Alto.*$/i, "") ||
      source.name ||
      "",
  );
}

function openCitiesEventDescription(html, title) {
  const meta = pageDescription(html);
  if (meta) return meta;
  const firstParagraph = html.match(/<p[^>]*>([\s\S]*?)<\/p>/i)?.[1] || "";
  return descriptionFromLines(htmlToLines(firstParagraph), title, "");
}

function openCitiesCost(html) {
  for (const match of html.matchAll(/<p[^>]+class=["'][^"']*side-box-cost[^"']*["'][^>]*>([\s\S]*?)<\/p>/gi)) {
    const text = stripUnsafeText(match[1], 80);
    if (text && !/^cost$/i.test(text)) return text;
  }
  return "";
}

function openCitiesAttr(attrs, name) {
  return attrs.match(new RegExp(`${name}=['"]([^'"]+)['"]`, "i"))?.[1] || "";
}

function openCitiesDateTime(attrs, prefix) {
  const year = openCitiesAttr(attrs, `${prefix}-year`);
  const month = openCitiesAttr(attrs, `${prefix}-month`);
  const day = openCitiesAttr(attrs, `${prefix}-day`);
  const hour = openCitiesAttr(attrs, `${prefix}-hour`) || "10";
  const minute = openCitiesAttr(attrs, `${prefix}-mins`) || "00";
  if (!year || !month || !day) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00-07:00`;
}

export function extractOpenCitiesEventEvents(html, source = {}) {
  const title = openCitiesEventTitle(html, source);
  if (!title || isGenericPageTitle(title)) return [];

  const description = openCitiesEventDescription(html, title);
  const cost = openCitiesCost(html) || source.cost || inferCost(`${title} ${description}`);
  const signalText = `${title} ${description} ${sourceAudienceText(source)}`;
  if (hasAdultOnlySignal(signalText)) return [];

  const events = [];
  const blocks = html.matchAll(/<li[^>]+class=["'][^"']*multi-date-item[^"']*["']([^>]*)>([\s\S]*?)<\/li>/gi);
  for (const match of blocks) {
    const attrs = match[1] || "";
    const startDateTime = openCitiesDateTime(attrs, "data-start");
    if (!startDateTime) continue;
    const endDateTime =
      openCitiesDateTime(attrs, "data-end") ||
      addMinutesToLocalIso(startDateTime, Number(source.defaultDurationMinutes || 60));
    const event = normalizeRawEvent({
      title,
      description,
      venue: source.venue || source.name,
      city: source.city,
      neighborhood: source.neighborhood || source.city,
      lat: source.lat,
      lon: source.lon,
      category: source.category || inferCategory(signalText, "Culture"),
      startDateTime,
      endDateTime,
      ageBands: inferAgeBands(signalText),
      cost,
      url: source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.homeUrl || source.url,
      extractionMethod: "open-cities-event",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  return dedupeEvents(events);
}

export function normalizeDateTime(value, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const raw = stripUnsafeText(value, 120);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return parseLooseDate(raw, new Date(), timezoneOffset);
}

export function normalizeRawEvent(raw, source = {}) {
  const timezoneOffset = raw.timezoneOffset || source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const title = cleanEventTitle(raw.title);
  const description = stripUnsafeText(raw.description, 360);
  const combined = `${title} ${description}`;
  if (!title) return null;
  // Adult-only signal in the text is only a rejection if the source/event
  // didn't opt in to the adults audience. With the dual-app pipeline, an
  // adults-tagged feed (event-sources-adults.json) expects exactly this
  // language and should be allowed through.
  const audiences = resolveAudiences(raw, source, combined);
  const adultIntent =
    audiences.includes("adults") && !audiences.includes("kids");
  if (!adultIntent && hasAdultOnlySignal(combined)) return null;
  if (/\b(cancel(?:ed|led)|postponed)\b/i.test(combined)) return null;
  if (/^(closed|closure)$/i.test(title) || /\b(?:will be|is|are)\s+closed\b/i.test(description)) return null;
  if ((raw.extractionMethod === "html" || raw.extractionMethod === "rss") && isGenericPageTitle(title)) {
    return null;
  }

  const startDateTime = normalizeDateTime(raw.startDateTime, timezoneOffset);
  const endDateTime = normalizeDateTime(raw.endDateTime, timezoneOffset) || (startDateTime ? addMinutesToLocalIso(startDateTime, 60) : null);
  const days = startDateTime ? [dayOfWeek(startDateTime)].filter((d) => d !== null) : [];
  const category = stripUnsafeText(raw.category || inferCategory(combined, source.category || "Museum"), 40);
  const ageBands = Array.isArray(raw.ageBands) && raw.ageBands.length > 0
    ? raw.ageBands.filter((band) => AGE_BANDS.includes(band))
    : inferAgeBands(combined);

  return {
    id: raw.id || `${source.id || "source"}-${slugify(title)}-${hash(`${title}|${raw.venue}|${startDateTime || raw.url || source.url}`)}`,
    baseId: raw.baseId || null,
    title,
    description,
    venue: stripUnsafeText(raw.venue || source.name || title, 100),
    city: stripUnsafeText(raw.city || source.city || "Bay Area", 80),
    neighborhood: stripUnsafeText(raw.neighborhood || raw.city || source.city || "Bay Area", 80),
    lat: Number(
      raw.lat ??
        source.lat ??
        lookupCityCentroid(raw.city || source.city)?.[0] ??
        37.7749,
    ),
    lon: Number(
      raw.lon ??
        source.lon ??
        lookupCityCentroid(raw.city || source.city)?.[1] ??
        -122.4194,
    ),
    category,
    daysOfWeek: Array.isArray(raw.daysOfWeek) && raw.daysOfWeek.length > 0
      ? raw.daysOfWeek.map(Number).filter((day) => day >= 0 && day <= 6)
      : days,
    timeWindow: raw.timeWindow || (startDateTime ? inferTimeWindowFromDate(startDateTime) : "Afternoon"),
    startDateTime,
    endDateTime,
    ageBands: ageBands.length > 0 ? ageBands : ["preschool", "school-age"],
    audiences,
    cost: stripUnsafeText(raw.cost || inferCost(combined), 30),
    url: sanitizeUrl(raw.url || raw.sourceUrl || source.url, source.url) || source.url,
    sourceUrl: sanitizeUrl(raw.sourceUrl || source.url, source.url) || source.url,
    sourceId: stripUnsafeText(raw.sourceId || source.id || "", 80),
    sourceName: stripUnsafeText(raw.sourceName || source.name || "", 120),
    sourceMode: stripUnsafeText(raw.sourceMode || raw.extractionMethod || "live", 40),
    extractionMethod: stripUnsafeText(raw.extractionMethod || "unknown", 40),
    verified: raw.verified === true,
    fetchedAt: raw.fetchedAt || null,
  };
}

const VALID_AUDIENCES = new Set(["kids", "adults", "all"]);

// Decide which audience(s) a spot or event serves. Order of precedence:
//   1. Explicit raw.audiences array (the most specific signal — manual entry).
//   2. source.audiences array (whole feed serves one audience).
//   3. Heuristics on the title+description text (e.g., "21+", "kids only").
//   4. Default: ["all"] — usable by both apps.
//
// Exporting so the spot ingest script can reuse the same rules.
export function resolveAudiences(raw = {}, source = {}, combinedText = "") {
  function clean(arr) {
    if (!Array.isArray(arr)) return null;
    const filtered = arr
      .map((v) => String(v || "").toLowerCase().trim())
      .filter((v) => VALID_AUDIENCES.has(v));
    return filtered.length > 0 ? Array.from(new Set(filtered)) : null;
  }
  const fromRaw = clean(raw.audiences);
  if (fromRaw) return fromRaw;
  const fromSource = clean(source.audiences);
  if (fromSource) return fromSource;
  const text = String(combinedText || "");
  if (/\b21\s*\+|\bover 21\b|\bages? 21\b|\badults? only\b|\bbrewery\b|\bwhiskey\b|\bcocktail\b/i.test(text)) {
    return ["adults"];
  }
  if (/\bkids? only\b|\bchildren only\b|\bunder 18\b|\bages? 0\s*[-–]\s*\d+\b|\bstorytime\b|\btoddler\b|\bpreschool\b/i.test(text)) {
    return ["kids"];
  }
  return ["all"];
}

function cleanEventTitle(value) {
  const title = stripUnsafeText(value, 140).replace(/^\d{4}-\d{2}-\d{2}\s+/, "");
  const featured = title.match(/^(.+?)\s+Featured Event\.\s+(.+)$/i);
  if (featured && featured[2].toLowerCase().startsWith(featured[1].toLowerCase())) {
    return stripUnsafeText(featured[1], 140);
  }
  const repeated = title.match(/^(.{8,70}?)\s+\1\b/i);
  if (repeated) {
    return stripUnsafeText(repeated[1], 140);
  }
  return stripUnsafeText(
    title
      .replace(/\s+Featured Event\.\s*/i, " "),
    140,
  );
}

function isGenericPageTitle(title) {
  return GENERIC_PAGE_TITLES.some((pattern) => pattern.test(title));
}

export function expandRecurringTemplates(templates, source = {}, options = {}) {
  const now = options.now ? new Date(options.now) : new Date();
  const windowDays = Number(options.windowDays || DEFAULT_WINDOW_DAYS);
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const end = addDays(start, windowDays);
  const expanded = [];

  for (const template of templates) {
    const days = Array.isArray(template.daysOfWeek) ? template.daysOfWeek.map(Number) : [];
    if (days.length === 0) continue;
    let emitted = 0;
    for (let cursor = new Date(start); cursor <= end; cursor = addDays(cursor, 1)) {
      if (!days.includes(cursor.getUTCDay())) continue;
      const startDateTime = localIso(cursor, TIME_WINDOW_START[template.timeWindow] || TIME_WINDOW_START.Afternoon, source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET);
      const event = normalizeRawEvent({
        ...template,
        id: `${template.id}-${dateOnly(cursor)}`,
        baseId: template.id,
        startDateTime,
        endDateTime: addMinutesToLocalIso(startDateTime, 60),
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceMode: "recurring-template",
        extractionMethod: "recurring-template",
      }, source);
      if (event) {
        event.verified = template.verified === true;
        expanded.push(event);
        emitted += 1;
      }
      if (emitted >= Number(options.maxOccurrencesPerTemplate || 4)) break;
    }
  }

  return expanded;
}

// CivicPlus (the CMS Sunnyvale and many .ca.gov library/parks sites use)
// renders its public calendar as an HTML <table> with one <td> per day. Each
// day cell contains:
//   <td class="calendar_day calendar_day_with_items">
//     5
//     <div class="calendar_items">
//       <div class="calendar_item">
//         <span class="calendar_eventtime">11:00 AM</span>
//         <a class="calendar_eventlink" href="/Home/Components/Calendar/Event/{id}/74"
//            title="Toddler Storytime">Toddler Storytime</a>
//       </div>
//       …
//     </div>
//   </td>
//
// Month + year come from the prev/next month nav links (`-curm-{N}/-cury-{Y}`).
// This is enough to materialize concrete dated events without follow-up
// requests to per-event detail pages.
export function extractCivicPlusCalendarEvents(html, source = {}, options = {}) {
  if (typeof html !== "string" || html.length === 0) return [];
  const monthYear = inferCivicPlusMonthYear(html);
  if (!monthYear) return [];
  const { month, year } = monthYear;
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;

  const events = [];
  const dayCellRegex = /<td[^>]*class="[^"]*calendar_day[^"]*"[^>]*>([\s\S]*?)<\/td>/gi;
  for (const cellMatch of html.matchAll(dayCellRegex)) {
    const cell = cellMatch[1];
    if (!/calendar_day_with_items/i.test(cellMatch[0])) continue;
    const dayMatch = cell.match(/^\s*(\d{1,2})/);
    if (!dayMatch) continue;
    const day = Number(dayMatch[1]);
    if (!day || day < 1 || day > 31) continue;
    const itemRegex =
      /<div class="calendar_item">\s*(?:<span[^>]*class="calendar_eventtime"[^>]*>([^<]+)<\/span>)?\s*<a[^>]*class="calendar_eventlink"[^>]*href="([^"]+)"[^>]*title="([^"]*)"[^>]*>([^<]*)<\/a>/gi;
    for (const item of cell.matchAll(itemRegex)) {
      const timeText = (item[1] || "").trim();
      const href = item[2];
      const title = decodeHtmlEntities((item[3] || item[4] || "").trim());
      if (!title) continue;
      const startClock = parseCivicPlusClock(timeText);
      if (!startClock) continue;
      const startDateTime = localDateTime(
        new Date(Date.UTC(year, month - 1, day)),
        startClock,
        timezoneOffset,
      );
      if (!startDateTime) continue;
      const endDateTime = addMinutesToLocalIso(startDateTime, 60);
      const url = href.startsWith("http")
        ? href
        : new URL(href, source.url).toString();
      const event = normalizeRawEvent(
        {
          title,
          startDateTime,
          endDateTime,
          url,
          sourceUrl: source.url,
          sourceMode: "civicpluscal",
          extractionMethod: "civicpluscal",
        },
        source,
      );
      if (event) events.push(event);
    }
  }
  return events;
}

function inferCivicPlusMonthYear(html) {
  // The page renders prev/next month nav links containing -curm-{N}/-cury-{Y}.
  // Parse next-month and step back a month to get the displayed month.
  const re = /-curm-(\d{1,2})\/-cury-(\d{4})/g;
  const matches = [...html.matchAll(re)];
  if (matches.length === 0) return null;
  // Sort numeric: prev < next. Use the higher one as next-month.
  const tuples = matches.map((m) => ({
    month: Number(m[1]),
    year: Number(m[2]),
  }));
  tuples.sort((a, b) => a.year - b.year || a.month - b.month);
  const next = tuples[tuples.length - 1];
  let month = next.month - 1;
  let year = next.year;
  if (month < 1) {
    month = 12;
    year -= 1;
  }
  return { month, year };
}

function parseCivicPlusClock(text) {
  if (typeof text !== "string") return null;
  const match = text
    .trim()
    .match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (!match) return null;
  let hour = Number(match[1]);
  const minute = Number(match[2] || "0");
  const meridiem = match[3].toUpperCase();
  if (hour === 12) hour = 0;
  if (meridiem === "PM") hour += 12;
  return { hour, minute };
}

export function extractEventsFromPayload(payload, source = {}, options = {}) {
  const contentType = payload.contentType || "";
  const text = payload.text || "";
  if (source.sourceType === "libcal") {
    return extractLibCalEvents(payload.json, source);
  }
  if (source.sourceType === "biblioevents") {
    return extractBiblioEvents(text, source, options);
  }
  if (source.sourceType === "librarycalendar") {
    return extractLibraryCalendarEvents(text, source, options);
  }
  if (source.sourceType === "sfplEvents") {
    return extractSfplEvents(text, source, options);
  }
  if (source.sourceType === "communicoEvents") {
    return extractCommunicoEvents(payload.json, source);
  }
  if (source.sourceType === "localistEvents") {
    return extractLocalistEvents(payload.json, source);
  }
  if (source.sourceType === "drupalViewsAjax") {
    return extractDrupalCardEvents(text, source, options);
  }
  if (source.sourceType === "chicagoParkDistrictEvents") {
    return extractChicagoParkDistrictEvents(text, source, options);
  }
  if (source.sourceType === "eventList") {
    return extractEventListEvents(text, source, options);
  }
  if (source.sourceType === "lincolnCenterFamily") {
    return extractLincolnCenterFamilyEvents(text, source, options);
  }
  if (source.sourceType === "newVictoryEvents") {
    return extractNewVictoryEvents(payload.json, source);
  }
  if (source.sourceType === "nycParksEvents") {
    return extractNycParksEvents(text, source, options);
  }
  if (source.sourceType === "officialTextEvents") {
    return extractOfficialTextEvents(text, source, options);
  }
  if (source.sourceType === "openCitiesEvent") {
    return extractOpenCitiesEventEvents(text, source, options);
  }
  if (source.sourceType === "civicpluscal") {
    return extractCivicPlusCalendarEvents(text, source, options);
  }
  if (source.sourceType === "midpenTable") {
    return extractMidpenTableEvents(text, source, options);
  }
  if (source.sourceType === "ticketmaster") {
    return extractTicketmasterEvents(payload.json, source);
  }
  if (/calendar|ics/i.test(contentType) || source.sourceType === "ics" || /\.ics($|\?)/i.test(source.url)) {
    return extractIcsEvents(text, source);
  }
  if (/rss|atom|xml/i.test(contentType) || source.sourceType === "rss") {
    return extractRssEvents(text, source);
  }
  if (/json/i.test(contentType) && payload.json) {
    return extractJsonEvents(payload.json, source);
  }
  return extractHtmlEvents(text, source, options);
}

export function extractBiblioEvents(html, source = {}, options = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const lines = htmlToLines(html);
  const start = Math.max(0, lines.findIndex((line) => /^#{1,3}\s*event items$/i.test(line) || /^event items$/i.test(line)));
  const scoped = lines.slice(start >= 0 ? start : 0);
  const events = [];

  for (let index = 0; index < scoped.length; index += 1) {
    if (!scoped[index].startsWith("###")) continue;
    const title = titleFromHeading(scoped[index]);
    if (!title || isGenericPageTitle(title)) continue;
    let end = scoped.length;
    for (let cursor = index + 1; cursor < scoped.length; cursor += 1) {
      if (scoped[cursor].startsWith("###")) {
        end = cursor;
        break;
      }
    }
    const blockLines = scoped.slice(index + 1, Math.min(end, index + 34));
    if (!hasBiblioYouthAudience(blockLines)) continue;
    const dateLine = blockLines.find((line) => parseDateTimeRange(line, options.now || new Date(), timezoneOffset));
    if (!dateLine && !parseDateTimeRange(blockLines.join(" "), options.now || new Date(), timezoneOffset)) continue;
    const event = normalizeLineEvent({
      title,
      dateLine,
      lines: blockLines,
      html,
      source,
      options,
      method: "biblioevents",
      fallbackCategory: "Library",
    });
    if (event) events.push(event);
  }

  return dedupeEvents(events);
}

export function extractLibraryCalendarEvents(html, source = {}, options = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const blocks = html.match(/<div class="lc-event event-card lc-featured-event[\s\S]*?(?=<div class="lc-event event-card lc-featured-event|<div class="calendar-wrap|$)/gi) || [];
  const events = [];
  for (const block of blocks) {
    const title =
      stripUnsafeText(block.match(/<div class="lc-featured-event-content">[\s\S]*?<h2[^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i)?.[1], 140) ||
      stripUnsafeText(block.match(/<h3[^>]+class=["'][^"']*lc-event__title--details[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1], 140);
    if (!title || isGenericPageTitle(title)) continue;

    const dateText =
      stripUnsafeText(block.match(/lc-featured-event-info-item--date[^>]*>([\s\S]*?)<\/div>/i)?.[1], 180) ||
      stripUnsafeText(block.match(/aria-label=["'][^"']* on ([^"']+)["']/i)?.[1], 180);
    const range = parseDateTimeRange(dateText, options.now || new Date(), timezoneOffset);
    if (!range) continue;

    const text = stripUnsafeText(block, 1800);
    if (/cancel(?:ed|led)/i.test(text) || !hasFamilySignal(`${title} ${text}`) || hasAdultOnlySignal(`${title} ${text}`)) {
      continue;
    }
    const ageBands = inferAgeBands(`${title} ${text}`);
    if (ageBands.length === 0) continue;
    const event = normalizeRawEvent({
      title,
      description: stripUnsafeText(block.match(/lc-event__body[\s\S]*?<div[^>]*field-item[^>]*>([\s\S]*?)<\/div>/i)?.[1] || text, 500),
      venue:
        stripUnsafeText(block.match(/lc-featured-event-location["'][^>]*>([\s\S]*?)<\/div>/i)?.[1], 120) ||
        stripUnsafeText(block.match(/<div class="lc-event__branch">[\s\S]*?<strong>Event Location:\s*<\/strong>([\s\S]*?)<\/div>/i)?.[1], 120) ||
        source.name,
      city: source.city,
      category: source.category || "Library",
      startDateTime: range.startDateTime,
      endDateTime: range.endDateTime,
      ageBands,
      url: sanitizeUrl(block.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1], source.url) || source.url,
      cost: inferCost(text),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "librarycalendar",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  if (events.length > 0) return dedupeEvents(events);
  return extractStructuredHtmlEvents(html, source, { ...options, method: "librarycalendar" });
}

function parseSfplDateTimeRange(text) {
  const clean = cleanDateText(text);
  const match = clean.match(/\b(?:Sunday|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday),?\s*(\d{1,2})\/(\d{1,2})\/(20\d{2}),?\s*(\d{1,2})(?::(\d{2}))?\s*-\s*(\d{1,2})(?::(\d{2}))?/i);
  if (!match) return null;

  const date = parseNumericDate(match[1], match[2], match[3]);
  if (!date) return null;
  const startHourRaw = Number(match[4]);
  const startMinute = Number(match[5] || 0);
  const endHourRaw = Number(match[6]);
  const endMinute = Number(match[7] || 0);
  if (
    startHourRaw < 1 ||
    startHourRaw > 12 ||
    endHourRaw < 1 ||
    endHourRaw > 12 ||
    startMinute > 59 ||
    endMinute > 59
  ) {
    return null;
  }

  const inferStartHour = (hour) => {
    if (hour === 12) return 12;
    return hour < 8 ? hour + 12 : hour;
  };
  const startClock = { hour: inferStartHour(startHourRaw), minute: startMinute };
  let endHour = endHourRaw === 12 ? 12 : endHourRaw;
  if (startClock.hour >= 12 && endHourRaw < 12) {
    endHour = endHourRaw + 12;
  } else if (endHour < startClock.hour || (endHour === startClock.hour && endMinute < startMinute)) {
    endHour += 12;
  }

  return {
    startDateTime: localDateTime(date, startClock),
    endDateTime: localDateTime(date, { hour: endHour, minute: endMinute }),
  };
}

function fieldItemsText(block, className) {
  const section = block.match(new RegExp(`<div[^>]+class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)(?:<\\/div>\\s*<\\/div>|<\\/div>\\s*<div class=["']event__)`, "i"))?.[1] || "";
  return Array.from(section.matchAll(/<a[^>]*>([\s\S]*?)<\/a>|<div[^>]+class=["'][^"']*field__item[^"']*["'][^>]*>([\s\S]*?)<\/div>/gi))
    .map((match) => stripUnsafeText(match[1] || match[2] || "", 120))
    .filter(Boolean);
}

function sfplVenueFromBlock(block, source) {
  return stripUnsafeText(
    block.match(/class=["']location--short-label["'][\s\S]*?field--name-field-short-name[^>]*>([\s\S]*?)<\/div>/i)?.[1] ||
      block.match(/field--name-field-event-location[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1] ||
      source.venue ||
      source.name,
    100,
  );
}

export function extractSfplEvents(html, source = {}, options = {}) {
  const rows = html.match(/<div class="views-row"><div class="views-field views-field-rendered-entity">[\s\S]*?(?=<div class="views-row"><div class="views-field views-field-rendered-entity">|<nav class="pager"|$)/gi) || [];
  const events = [];

  for (const row of rows) {
    if (!/\bevent--teaser\b/i.test(row)) continue;
    const title = stripUnsafeText(
      row.match(/<h2[^>]+class=["'][^"']*event__title[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["'][^>]*>[\s\S]*?<span>([\s\S]*?)<\/span>/i)?.[2],
      140,
    );
    const eventPath =
      row.match(/<h2[^>]+class=["'][^"']*event__title[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i)?.[1] ||
      row.match(/<article[^>]+about=["']([^"']+)["']/i)?.[1];
    const dateText = stripUnsafeText(
      row.match(/class=["']date-display-range["'][^>]*>([\s\S]*?)<\/span>/i)?.[1],
      160,
    );
    const range = parseSfplDateTimeRange(dateText);
    if (!title || !range) continue;

    const audience = fieldItemsText(row, "field--name-field-event-audience");
    const topics = fieldItemsText(row, "field--name-field-event-topic");
    const venue = sfplVenueFromBlock(row, source);
    const text = stripUnsafeText(row, 1300);
    const signalText = `${title} ${dateText} ${venue} ${audience.join(" ")} ${topics.join(" ")} ${sourceAudienceText(source)}`;
    const ageBands = inferAgeBands(signalText);
    if (ageBands.length === 0) continue;

    const event = normalizeRawEvent({
      title,
      description: [dateText, venue, ...audience, ...topics].filter(Boolean).join(" | ") || text,
      venue,
      city: source.city,
      category: source.category || "Library",
      startDateTime: range.startDateTime,
      endDateTime: range.endDateTime,
      ageBands,
      url: sanitizeUrl(eventPath, source.url) || source.url,
      cost: "Free",
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourceMode: "sfpl-events",
      extractionMethod: "sfpl-events",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  return dedupeEvents(events);
}

function communicoList(item, arrayKey, stringKey) {
  if (Array.isArray(item?.[arrayKey])) {
    return item[arrayKey]
      .map((value) => stripUnsafeText(value, 100))
      .filter(Boolean);
  }
  const raw = typeof item?.[stringKey] === "string" ? item[stringKey] : "";
  return raw
    .split(/\s*,\s*/)
    .map((value) => stripUnsafeText(value, 100))
    .filter(Boolean);
}

function communicoDateTime(value) {
  const raw = stripUnsafeText(value, 100);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
  if (match) return `${match[1]}T${match[2]}:${match[3]}:${match[4] || "00"}-07:00`;
  return raw;
}

function communicoLocationMap(json) {
  const map = new Map();
  const locations = Array.isArray(json?.locations) ? json.locations : [];
  for (const location of locations) {
    if (location?.id) map.set(String(location.id), location);
  }
  return map;
}

function communicoAgeBands(ages, text) {
  const bands = new Set();
  for (const age of ages) {
    const lower = age.toLowerCase();
    if (/\b(early childhood|baby|babies|toddler|toddlers|preschool)\b/.test(lower)) {
      bands.add("toddler");
      bands.add("preschool");
    }
    if (/\b(elementary|children|kids|school age|school-age)\b/.test(lower)) {
      bands.add("school-age");
    }
    if (/\b(preteens?|teens?|tweens?|middle school)\b/.test(lower)) {
      bands.add("tween");
    }
    if (/\b(families|family|all ages)\b/.test(lower)) {
      bands.add("preschool");
      bands.add("school-age");
    }
  }
  if (ages.length === 0) {
    for (const band of inferAgeBands(text)) {
      bands.add(band);
    }
  }
  return AGE_BANDS.filter((band) => bands.has(band));
}

function communicoAudiences(ages, ageBands) {
  const hasAdults = ages.some((age) => /\badults?\b/i.test(age));
  if (ageBands.length === 0 && hasAdults) return ["adults"];
  if (ageBands.length > 0 && hasAdults) return ["all"];
  if (ageBands.length > 0) return ["kids"];
  return ["all"];
}

function communicoCost(item, text) {
  const registrationCost = Number(item?.registration_cost || 0);
  if (Number.isFinite(registrationCost) && registrationCost > 0) {
    return `$${registrationCost}`;
  }
  return inferCost(`${text} free library`);
}

function communicoEventUrl(item, source) {
  if (item?.id) {
    try {
      return new URL(`/event/${item.id}`, source.url).toString();
    } catch {
      return source.url;
    }
  }
  return sanitizeUrl(item?.url, source.url) || source.url;
}

export function extractCommunicoEvents(json, source = {}) {
  const rawEvents = Array.isArray(json) ? json : Array.isArray(json?.events) ? json.events : [];
  const locations = communicoLocationMap(json);
  const events = [];

  for (const item of rawEvents) {
    if (!item || Number(item.changed || 0) === 1) continue;
    const title = stripUnsafeText(item.title, 140);
    const subtitle = stripUnsafeText(item.sub_title, 180);
    const description = stripUnsafeText(
      [subtitle, item.description, item.long_description].filter(Boolean).join(" "),
      800,
    );
    const ages = communicoList(item, "agesArray", "ages");
    const tags = communicoList(item, "tagsArray", "tags");
    const searchTags = communicoList(item, "search_tagsArray", "search_tags");
    const signalText = `${title} ${description} ${ages.join(" ")} ${tags.join(" ")} ${searchTags.join(" ")}`;
    const ageBands = communicoAgeBands(ages, signalText);
    if (!title || ageBands.length === 0) continue;

    const location = locations.get(String(item.location_id || ""));
    const lat = Number(location?.lat);
    const lon = Number(location?.lon);
    const hasGeo = Number.isFinite(lat) && Number.isFinite(lon) && lat !== 0 && lon !== 0;
    const branch = stripUnsafeText(item.location || item.library || location?.name || source.name, 100);
    const room = stripUnsafeText(item.venues || item.venue_name || item.venue_room || "", 100);
    const venue = [branch, room].filter(Boolean).join(" - ");

    const event = normalizeRawEvent({
      id: item.id ? `${source.id}-${item.id}` : null,
      title,
      description,
      venue,
      city: stripUnsafeText(location?.locality || source.city, 80),
      neighborhood: branch || source.city,
      lat: hasGeo ? lat : source.lat,
      lon: hasGeo ? lon : source.lon,
      category: source.category || "Library",
      startDateTime: communicoDateTime(item.raw_start_time || item.event_start),
      endDateTime: communicoDateTime(item.raw_end_time || item.event_end),
      ageBands,
      audiences: communicoAudiences(ages, ageBands),
      cost: communicoCost(item, signalText),
      url: communicoEventUrl(item, source),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourceMode: "communico-events",
      extractionMethod: "communico-events",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  return dedupeEvents(events);
}

const DEFAULT_LOCALIST_ALLOWED_TYPES = [
  "Exhibition",
  "Film/Screening",
  "Performance",
  "Social Event/Reception",
  "Tour",
  "Workshop",
];

const LOCALIST_EXCLUDED_PATTERNS = [
  /\balcoholics anonymous\b/i,
  /\bal-anon\b/i,
  /\bcolloquium\b/i,
  /\bconference\b/i,
  /\bdoctoral\b/i,
  /\bfaculty meet\b/i,
  /\bgrand rounds\b/i,
  /\binformation session\b/i,
  /\boffice hours\b/i,
  /\bph\.?d\.?\b/i,
  /\bpostdoctoral fellowship\b/i,
  /\bseminar\b/i,
  /\bsymposium\b/i,
  /\bthesis\b/i,
  /\bvolunteer(?:ing)?\b/i,
];

function localistNames(value) {
  return maybeArray(value)
    .map((item) => stripUnsafeText(item?.name || item, 100))
    .filter(Boolean);
}

function localistFilterNames(item, key) {
  return localistNames(item?.filters?.[key]);
}

function localistIsPublic(audiences, source = {}) {
  if (source.localistRequirePublicAudience === false) return true;
  return audiences.some((audience) => /^(everyone|general public)$/i.test(audience));
}

function localistHasAllowedType(types, source = {}) {
  const allowed = new Set(
    (Array.isArray(source.localistAllowedTypeNames) && source.localistAllowedTypeNames.length > 0
      ? source.localistAllowedTypeNames
      : DEFAULT_LOCALIST_ALLOWED_TYPES
    ).map((type) => type.toLowerCase()),
  );
  return types.some((type) => allowed.has(type.toLowerCase()));
}

function localistHasExcludedSignal(signalText) {
  return LOCALIST_EXCLUDED_PATTERNS.some((pattern) => pattern.test(signalText));
}

function localistNeedsFamilySignal(types) {
  const typeText = types.join(" ");
  const broadCampusType = /\b(workshop|social event\/reception)\b/i.test(typeText);
  const outingType = /\b(exhibition|film\/screening|performance|tour)\b/i.test(typeText);
  return broadCampusType && !outingType;
}

function localistHasFamilySignal(signalText) {
  return inferAgeBands(signalText).length > 0 || /\b(all ages|family friendly|for families|museum minis)\b/i.test(signalText);
}

function localistDateTime(instance, source = {}, role = "start") {
  const raw = stripUnsafeText(role === "end" ? instance?.end : instance?.start, 120);
  if (!raw) return null;
  if (instance?.all_day) {
    const date = raw.slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      const fallbackTime = role === "end"
        ? source.localistAllDayEndTime || "17:00"
        : source.localistAllDayStartTime || "10:00";
      return `${date}T${fallbackTime}:00-07:00`;
    }
  }
  return raw;
}

function localistAgeBands(signalText) {
  const inferred = inferAgeBands(signalText);
  if (inferred.length > 0) return inferred;
  return ["school-age", "tween"];
}

function localistCategory(types, subjects, signalText, source = {}) {
  const typeText = types.join(" ");
  const subjectText = subjects.join(" ");
  if (/\b(performance)\b/i.test(typeText) || /\bmusic\b/i.test(subjectText) || /\b(concert|recital|carillon|orchestra|choir|piano|harp)\b/i.test(signalText)) {
    return "Music";
  }
  if (/\b(workshop|social event\/reception)\b/i.test(typeText)) {
    return "Community";
  }
  if (/\b(exhibition|tour|film\/screening)\b/i.test(typeText)) {
    return "Museum";
  }
  return inferCategory(signalText, source.category || "Museum");
}

function localistCost(item, signalText) {
  const ticketCost = stripUnsafeText(item?.ticket_cost, 40);
  if (item?.free === true) return "Free";
  if (ticketCost) return ticketCost;
  return inferCost(signalText);
}

function localistVenue(item, source = {}) {
  const primary = stripUnsafeText(item?.location_name || item?.location || source.name, 100);
  const room = stripUnsafeText(item?.room_number, 80);
  if (room && primary && !primary.toLowerCase().includes(room.toLowerCase())) {
    return `${primary} - ${room}`;
  }
  return primary || source.name;
}

function localistEventUrl(item, source = {}) {
  return (
    sanitizeUrl(item?.localist_url, source.url) ||
    sanitizeUrl(item?.url, source.url) ||
    sanitizeUrl(item?.ticket_url, source.url) ||
    source.url
  );
}

export function extractLocalistEvents(json, source = {}) {
  const rawEvents = Array.isArray(json) ? json : Array.isArray(json?.events) ? json.events : [];
  const events = [];

  for (const wrapper of rawEvents) {
    const item = wrapper?.event || wrapper;
    if (!item || item.private === true || item.status !== "live") continue;
    const title = stripUnsafeText(item.title, 140);
    const description = stripUnsafeText(item.description_text || item.description || "", 700);
    const types = localistFilterNames(item, "event_types");
    const audiences = localistFilterNames(item, "event_audience");
    const subjects = localistFilterNames(item, "event_subject");
    const departments = localistNames(item.departments);
    const groups = localistNames(item.groups);
    const signalText = [
      title,
      description,
      types.join(" "),
      audiences.join(" "),
      subjects.join(" "),
      departments.join(" "),
      groups.join(" "),
      item.location_name,
    ].filter(Boolean).join(" ");

    if (!title || !localistIsPublic(audiences, source)) continue;
    if (!localistHasAllowedType(types, source)) continue;
    if (localistNeedsFamilySignal(types) && !localistHasFamilySignal(signalText)) continue;
    if (localistHasExcludedSignal(signalText)) continue;
    if (hasAdultOnlySignal(signalText)) continue;

    const instances = Array.isArray(item.event_instances) && item.event_instances.length > 0
      ? item.event_instances
      : [{ event_instance: { id: item.id, start: item.first_date, end: item.last_date, all_day: true } }];

    for (const instanceWrapper of instances) {
      const instance = instanceWrapper?.event_instance || instanceWrapper || {};
      const startDateTime = localistDateTime(instance, source, "start");
      if (!startDateTime) continue;
      const endDateTime = localistDateTime(instance, source, "end");
      const lat = Number(item.geo?.latitude);
      const lon = Number(item.geo?.longitude);
      const event = normalizeRawEvent({
        id: `${source.id}-${item.id || slugify(title)}-${instance.id || hash(startDateTime)}`,
        title,
        description,
        venue: localistVenue(item, source),
        city: stripUnsafeText(item.geo?.city || source.city, 80),
        neighborhood: stripUnsafeText(item.location_name || source.neighborhood || source.city, 80),
        lat: Number.isFinite(lat) ? lat : source.lat,
        lon: Number.isFinite(lon) ? lon : source.lon,
        category: localistCategory(types, subjects, signalText, source),
        startDateTime,
        endDateTime,
        ageBands: localistAgeBands(signalText),
        audiences: ["all"],
        cost: localistCost(item, signalText),
        url: localistEventUrl(item, source),
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        sourceMode: "localist-events",
        extractionMethod: "localist-events",
        verified: true,
      }, source);
      if (event) events.push(event);
    }
  }

  return dedupeEvents(events);
}

export function extractDrupalCardEvents(html, source = {}, options = {}) {
  const blocks = html.match(/<div class="col--6">[\s\S]*?(?=<div class="col--6">|<nav class="pager"|$)/gi) || [];
  const audienceText = source.defaultAudienceText || source.drupalViews?.defaultAudienceText || "all ages kids pre-school teens";
  const events = [];

  for (const block of blocks) {
    if (!/collection-card--event/i.test(block)) continue;
    const title = stripUnsafeText(
      block.match(/<h3[^>]+class=["'][^"']*collection-card__title[^"']*["'][^>]*>([\s\S]*?)<\/h3>/i)?.[1],
      140,
    );
    if (!title || isGenericPageTitle(title)) continue;
    const startDateTime = datetimeFromBlock(block, source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET);
    if (!startDateTime) continue;

    const text = stripUnsafeText(block, 1200);
    const signalText = `${title} ${text} ${audienceText}`;
    if (/cancel(?:ed|led)/i.test(signalText) || hasAdultOnlySignal(signalText)) continue;

    const location = block.match(/teaser__tag[^>]*teaser__tag--related-park[^>]*>([\s\S]*?)<\/span>\s*,?\s*([^<\n]+)/i);
    const venue = stripUnsafeText(location?.[1] || source.name, 100);
    const city = stripUnsafeText(location?.[2] || source.city, 80);
    const event = normalizeRawEvent({
      title,
      description: text,
      venue,
      city,
      category: source.category || "Park",
      startDateTime,
      ageBands: inferAgeBands(signalText),
      url: sanitizeUrl(block.match(/<a[^>]+href=["']([^"']+)["']/i)?.[1], source.url) || source.url,
      cost: inferCost(signalText),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "drupal-views-ajax",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  if (events.length > 0) return dedupeEvents(events);
  return extractStructuredHtmlEvents(html, source, options);
}

export function extractChicagoParkDistrictEvents(html, source = {}, options = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const blocks = html.match(/<div class="node--type-event node--view-mode-card">[\s\S]*?(?=<div class="node--type-event node--view-mode-card">|<nav\b|<\/form>|$)/gi) || [];
  const events = [];

  for (const block of blocks) {
    if (/event--date\s+cancelled|cancel(?:ed|led)/i.test(block)) continue;
    const title = stripUnsafeText(
      block.match(/<h3[^>]+class=["'][^"']*event--title[^"']*["'][^>]*>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1],
      140,
    );
    if (!title || isGenericPageTitle(title)) continue;
    const href = block.match(/<h3[^>]+class=["'][^"']*event--title[^"']*["'][^>]*>[\s\S]*?<a[^>]+href=["']([^"']+)["']/i)?.[1];
    const dateText = stripUnsafeText(
      block.match(/<div[^>]+class=["'][^"']*event--date[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1],
      120,
    );
    const durationText = stripUnsafeText(
      block.match(/<div[^>]+class=["'][^"']*event--duration[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1],
      120,
    );
    const range = parseDateTimeRange(`${dateText} ${durationText}`, options.now || new Date(), timezoneOffset);
    if (!range) continue;

    const locationText = stripUnsafeText(
      block.match(/<div[^>]+class=["'][^"']*event--location[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1],
      180,
    );
    const venue =
      stripUnsafeText(title.match(/\bat\s+(.+)$/i)?.[1], 100) ||
      locationText ||
      source.name;
    const signalText = `${title} ${locationText} ${sourceAudienceText(source)} Family Fun`;
    const event = normalizeRawEvent({
      title,
      description: `${title} at ${venue}`.slice(0, 500),
      venue,
      city: source.city || "Chicago",
      neighborhood: source.neighborhood || source.city || "Chicago",
      lat: source.lat,
      lon: source.lon,
      category: source.category || "Park",
      startDateTime: range.startDateTime,
      endDateTime: range.endDateTime,
      ageBands: inferAgeBands(signalText),
      url: sanitizeUrl(href, source.url) || source.url,
      cost: source.cost || inferCost(signalText),
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      sourceMode: "chicago-park-district",
      extractionMethod: "chicago-park-district",
      verified: true,
    }, source);
    if (event) events.push(event);
  }

  return dedupeEvents(events);
}

export function extractLibCalEvents(json, source = {}) {
  const timezoneOffset = source.timezoneOffset || DEFAULT_TIMEZONE_OFFSET;
  const events = Array.isArray(json?.results) ? json.results : [];
  return events
    .map((item) => {
      const audienceText = Array.isArray(item.audiences)
        ? item.audiences.map((audience) => audience.name).join(" ")
        : "";
      const categoryText = Array.isArray(item.categories_arr)
        ? item.categories_arr.map((category) => category.name).join(" ")
        : item.categories || "";
      const description = stripUnsafeText(item.description || item.shortdesc || "", 500);
      const title = stripUnsafeText(item.title, 140);
      const ageBands = inferAgeBands(`${title} ${description} ${audienceText} ${categoryText}`);
      if (ageBands.length === 0) return null;
      const venue =
        stripUnsafeText(item.location, 100) ||
        stripUnsafeText(item.locations?.[0]?.name, 100) ||
        source.name;
      return normalizeRawEvent({
        id: `${source.id}-${item.id}`,
        title,
        description,
        venue,
        city: source.city,
        neighborhood: source.neighborhood || source.city,
        lat: source.lat,
        lon: source.lon,
        category: source.category || "Library",
        startDateTime: libCalDateTime(item.startdt, timezoneOffset),
        endDateTime: libCalDateTime(item.enddt, timezoneOffset),
        ageBands,
        cost: item.registration_cost || inferCost(`${description} ${item.registration_cost || ""}`),
        url: item.url,
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        extractionMethod: "libcal",
        verified: true,
      }, source);
    })
    .filter(Boolean);
}

function libCalDateTime(value, timezoneOffset = DEFAULT_TIMEZONE_OFFSET) {
  const raw = stripUnsafeText(value, 80);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (match) return `${match[1]}T${match[2]}${timezoneOffset}`;
  return raw;
}

export function extractJsonEvents(json, source = {}) {
  const rawEvents =
    json?.events ||
    json?.items ||
    json?._embedded?.events ||
    (Array.isArray(json) ? json : []);
  if (!Array.isArray(rawEvents)) return [];
  return rawEvents
    .map((item) => normalizeRawEvent({
      title: item.title || item.name,
      description: item.description || item.summary,
      venue: item.venue?.name || item.location?.name || item.location || source.name,
      city: item.city || item.venue?.city || item.location?.address?.addressLocality || source.city,
      lat: item.lat || item.latitude || item.venue?.location?.latitude,
      lon: item.lon || item.longitude || item.venue?.location?.longitude,
      category: item.category || source.category,
      startDateTime: item.startDateTime || item.start || item.dates?.start?.dateTime,
      endDateTime: item.endDateTime || item.end || item.dates?.end?.dateTime,
      url: item.url || item.link || item.permaLinkUrl,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "json",
    }, source))
    .filter(Boolean);
}

export function extractTicketmasterEvents(json, source = {}) {
  const events = json?._embedded?.events || [];
  if (!Array.isArray(events)) return [];
  return events
    .map((item) => {
      const venue = item._embedded?.venues?.[0];
      return normalizeRawEvent({
        title: item.name,
        description: item.info || item.pleaseNote || "",
        venue: venue?.name || source.name,
        city: venue?.city?.name || source.city,
        lat: venue?.location?.latitude,
        lon: venue?.location?.longitude,
        category: "Ticketed",
        startDateTime: item.dates?.start?.dateTime || item.dates?.start?.localDate,
        endDateTime: item.dates?.end?.dateTime,
        url: item.url,
        cost: item.priceRanges?.length ? "$" : "Unknown",
        sourceId: source.id,
        sourceName: source.name,
        sourceUrl: source.url,
        extractionMethod: "ticketmaster",
      }, source);
    })
    .filter(Boolean);
}

export function dedupeEvents(events) {
  const best = new Map();
  for (const event of events) {
    if (!event) continue;
    const key = [
      slugify(event.title),
      slugify(event.venue),
      event.startDateTime || "",
    ].join("|");
    const existing = best.get(key);
    if (!existing || scoreEvent(event) > scoreEvent(existing)) {
      best.set(key, event);
    }
  }
  return Array.from(best.values()).sort((a, b) => {
    const aTime = a.startDateTime ? new Date(a.startDateTime).getTime() : Number.MAX_SAFE_INTEGER;
    const bTime = b.startDateTime ? new Date(b.startDateTime).getTime() : Number.MAX_SAFE_INTEGER;
    if (aTime !== bTime) return aTime - bTime;
    return a.title.localeCompare(b.title);
  });
}

function scoreEvent(event) {
  let score = 0;
  if (event.startDateTime) score += 10;
  if (event.endDateTime) score += 3;
  if (event.extractionMethod === "biblioevents") score += 8;
  if (event.extractionMethod === "json-ld") score += 8;
  if (event.extractionMethod === "ics") score += 7;
  if (event.extractionMethod === "librarycalendar") score += 7;
  if (event.extractionMethod === "sfpl-events") score += 7;
  if (event.extractionMethod === "drupal-views-ajax") score += 7;
  if (event.extractionMethod === "localist-events") score += 7;
  if (event.extractionMethod === "event-list") score += 7;
  if (event.extractionMethod === "official-text-event") score += 7;
  if (event.extractionMethod === "official-recurring-event") score += 7;
  if (event.extractionMethod === "midpen-table") score += 7;
  if (event.extractionMethod === "ticketmaster") score += 7;
  if (event.sourceMode === "recurring-template") score -= 2;
  if (event.verified) score += 3;
  return score;
}

export function buildEventsDataset(events, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const deduped = dedupeEvents(events).map((event) => ({
    ...event,
    fetchedAt: event.fetchedAt || generatedAt,
  }));
  return {
    schemaVersion: 2,
    metroId: options.metroId || null,
    generatedAt,
    source: {
      name: options.sourceName || "Event source registry",
      registryPath: options.registryPath || "data/event-sources.json",
      sourceCount: options.sourceCount || 0,
      attribution: "Official source pages and configured public event feeds",
    },
    coverage: options.coverage,
    count: deduped.length,
    events: deduped,
  };
}

export function validateEventsDataset(dataset, options = {}) {
  const errors = [];
  const minEvents = Number(options.minEvents ?? 1);
  const cities = new Set([...(options.cities || []), ...(options.communities || [])]);
  const bbox = options.bbox || null;
  const isInsideBbox = (event) =>
    bbox &&
    Number.isFinite(event.lat) &&
    Number.isFinite(event.lon) &&
    event.lat >= bbox.south &&
    event.lat <= bbox.north &&
    event.lon >= bbox.west &&
    event.lon <= bbox.east;
  if (!dataset || typeof dataset !== "object") return ["Events dataset must be an object."];
  if (!Array.isArray(dataset.events)) return ["Events dataset events must be an array."];
  if (dataset.events.length < minEvents) {
    errors.push(`Dataset has ${dataset.events.length} events, expected at least ${minEvents}.`);
  }
  const ids = new Set();
  for (const [index, event] of dataset.events.entries()) {
    const prefix = `events[${index}]`;
    for (const field of ["id", "title", "venue", "city", "category", "timeWindow", "url"]) {
      if (!event[field] || typeof event[field] !== "string") {
        errors.push(`${prefix}.${field} is required.`);
      }
    }
    if (ids.has(event.id)) errors.push(`${prefix}.id is duplicated.`);
    ids.add(event.id);
    if (!Array.isArray(event.daysOfWeek) || event.daysOfWeek.some((day) => !Number.isInteger(day) || day < 0 || day > 6)) {
      errors.push(`${prefix}.daysOfWeek must be weekday numbers.`);
    }
    if (!Array.isArray(event.ageBands) || event.ageBands.some((band) => !AGE_BANDS.includes(band))) {
      errors.push(`${prefix}.ageBands has invalid values.`);
    }
    if (
      event.audiences !== undefined &&
      (!Array.isArray(event.audiences) ||
        event.audiences.length === 0 ||
        event.audiences.some((a) => !VALID_AUDIENCES.has(a)))
    ) {
      errors.push(
        `${prefix}.audiences must be a non-empty subset of ["kids","adults","all"].`,
      );
    }
    if (!Number.isFinite(event.lat) || !Number.isFinite(event.lon)) {
      errors.push(`${prefix} must have numeric coordinates.`);
    }
    if (event.url && !sanitizeUrl(event.url)) errors.push(`${prefix}.url must be http or https.`);
    if (options.requireDated !== false) {
      const start = event.startDateTime ? new Date(event.startDateTime) : null;
      if (!start || !Number.isFinite(start.getTime())) {
        errors.push(`${prefix}.startDateTime is required for generated events.`);
      }
    }
    if (cities.size > 0 && event.city && !cities.has(event.city) && !isInsideBbox(event)) {
      errors.push(`${prefix}.city '${event.city}' is outside configured coverage.`);
    }
    // Adult-only signal is only a rejection reason when the event isn't tagged
    // for the adults audience. An adults-tagged event from event-sources-adults.json
    // is *expected* to mention 21+, breweries, etc.
    const audiences = Array.isArray(event.audiences) ? event.audiences : ["all"];
    const adultIntent = audiences.includes("adults") && !audiences.includes("kids");
    if (!adultIntent && hasAdultOnlySignal(`${event.title} ${event.description || ""}`)) {
      errors.push(`${prefix} appears adult-only but is tagged for kids/all.`);
    }
  }
  return errors;
}
