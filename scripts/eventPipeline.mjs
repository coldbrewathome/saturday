import crypto from "node:crypto";

export const DEFAULT_TIMEZONE = "America/Los_Angeles";
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
  /\bmission & history\b/i,
  /\bhours of operation\b/i,
  /\bin progress\b/i,
];

const CATEGORY_BY_TEXT = [
  ["Festival", /\b(festival|parade|street fair|art & wine|carnaval|pride|night market)\b/i],
  ["Community", /\b(community|open streets|first friday|block party)\b/i],
  ["Library", /\b(library|storytime|book|lego|maker|craft|reading)\b/i],
  ["Zoo", /\b(zoo|animal|wildlife|habitat)\b/i],
  ["Farm", /\b(farm|ranch|garden|harvest|goat|chicken)\b/i],
  ["Park", /\b(park|trail|nature|naturalist|tide|beach|refuge|outdoor)\b/i],
  ["Museum", /\b(museum|science|exhibit|exploratorium|academy|aquarium|discovery)\b/i],
];

const AGE_BANDS = ["toddler", "preschool", "school-age", "tween"];

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

function localIso(date, time = "10:00") {
  const [hour = "10", minute = "00"] = time.split(":");
  return `${dateOnly(date)}T${hour.padStart(2, "0")}:${minute.padStart(2, "0")}:00-07:00`;
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

function parseIcsDate(value) {
  const raw = stripUnsafeText(value, 80);
  if (!raw) return null;
  const compact = raw.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?Z?)?$/);
  if (!compact) return null;
  const [, y, m, d, hh = "10", mm = "00", ss = "00"] = compact;
  return `${y}-${m}-${d}T${hh}:${mm}:${ss}${raw.endsWith("Z") ? "Z" : "-07:00"}`;
}

export function extractIcsEvents(text, source = {}) {
  const unfolded = text.replace(/\r?\n[ \t]/g, "");
  const blocks = unfolded.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/g) || [];
  return blocks
    .map((block) => normalizeRawEvent({
      title: fieldFromIcs(block, "SUMMARY"),
      description: fieldFromIcs(block, "DESCRIPTION"),
      venue: fieldFromIcs(block, "LOCATION") || source.name,
      city: source.city,
      category: source.category,
      startDateTime: parseIcsDate(fieldFromIcs(block, "DTSTART")),
      endDateTime: parseIcsDate(fieldFromIcs(block, "DTEND")),
      url: fieldFromIcs(block, "URL") || source.url,
      sourceId: source.id,
      sourceName: source.name,
      sourceUrl: source.url,
      extractionMethod: "ics",
    }, source))
    .filter(Boolean);
}

export function extractRssEvents(text, source = {}) {
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
        startDateTime: parseLooseDate(textForDate, new Date()),
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
    const startDateTime = datetimeFromBlock(block) || parseLooseDate(text, options.now || new Date());
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

function datetimeFromBlock(block) {
  const timeMatch = block.match(/<time[^>]+datetime=["']([^"']+)["'][^>]*>/i);
  return timeMatch ? normalizeDateTime(timeMatch[1]) : null;
}

export function parseLooseDate(text, now = new Date()) {
  const clean = stripUnsafeText(text, 1200);
  const iso = clean.match(/\b(20\d{2})-(\d{2})-(\d{2})(?:[T ](\d{1,2}):(\d{2})(?::(\d{2}))?)?\b/);
  if (iso) {
    const [, y, m, d, hh = "10", mm = "00", ss = "00"] = iso;
    return `${y}-${m}-${d}T${hh.padStart(2, "0")}:${mm}:${ss}-07:00`;
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
  return `${dateOnly(date)}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-07:00`;
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

function localDateTime(date, clock) {
  if (!date || !clock) return null;
  return `${dateOnly(date)}T${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}:00-07:00`;
}

export function parseDateTimeRange(text, now = new Date()) {
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
    startDateTime: localDateTime(date, startClock),
    endDateTime: localDateTime(date, endClock),
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
  const joined = lines.join(" ");
  if (/cancel(?:ed|led)/i.test(joined)) return null;
  const range = parseDateTimeRange(dateLine || joined, options.now || new Date());
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
    const dateLine = blockLines.find((line) => parseDateTimeRange(line, options.now || new Date()));
    if (!dateLine && !parseDateTimeRange(blockLines.join(" "), options.now || new Date())) continue;
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
  const range = parseDateTimeRange(line, now);
  if (range) return range;

  const config = eventListOptions(source);
  const startTime = config.defaultStartTime || source.defaultStartTime;
  if (!startTime) return null;
  const date = parseMonthDay(line, now);
  const startClock = parseClock(startTime);
  if (!date || !startClock) return null;
  const startDateTime = localDateTime(date, startClock);
  const endTime = config.defaultEndTime || source.defaultEndTime;
  const endClock = endTime ? parseClock(endTime) : null;
  return {
    startDateTime,
    endDateTime: endClock
      ? localDateTime(date, endClock)
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
    const startDateTime = parseLooseDate(`${dateText} at ${timeText}`, now);
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
      const startDateTime = localDateTime(date, startClock);
      const endClock = config.endTime ? parseClock(config.endTime) : null;
      events.push(normalizeRawEvent({
        ...config,
        id: `${config.id || source.id}-${dateOnly(date)}`,
        startDateTime,
        endDateTime: endClock
          ? localDateTime(date, endClock)
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

export function normalizeDateTime(value) {
  const raw = stripUnsafeText(value, 120);
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isFinite(parsed.getTime())) return parsed.toISOString();
  return parseLooseDate(raw, new Date());
}

export function normalizeRawEvent(raw, source = {}) {
  const title = cleanEventTitle(raw.title);
  const description = stripUnsafeText(raw.description, 360);
  const combined = `${title} ${description}`;
  if (!title || hasAdultOnlySignal(combined)) return null;
  if ((raw.extractionMethod === "html" || raw.extractionMethod === "rss") && isGenericPageTitle(title)) {
    return null;
  }

  const startDateTime = normalizeDateTime(raw.startDateTime);
  const endDateTime = normalizeDateTime(raw.endDateTime) || (startDateTime ? addMinutesToLocalIso(startDateTime, 60) : null);
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
    lat: Number(raw.lat ?? source.lat ?? 37.7749),
    lon: Number(raw.lon ?? source.lon ?? -122.4194),
    category,
    daysOfWeek: Array.isArray(raw.daysOfWeek) && raw.daysOfWeek.length > 0
      ? raw.daysOfWeek.map(Number).filter((day) => day >= 0 && day <= 6)
      : days,
    timeWindow: raw.timeWindow || (startDateTime ? inferTimeWindowFromDate(startDateTime) : "Afternoon"),
    startDateTime,
    endDateTime,
    ageBands: ageBands.length > 0 ? ageBands : ["preschool", "school-age"],
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

function cleanEventTitle(value) {
  const title = stripUnsafeText(value, 140);
  const featured = title.match(/^(.+?)\s+Featured Event\.\s+(.+)$/i);
  if (featured && featured[2].toLowerCase().startsWith(featured[1].toLowerCase())) {
    return stripUnsafeText(featured[1], 140);
  }
  return stripUnsafeText(title.replace(/\s+Featured Event\.\s*/i, " "), 140);
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
      const startDateTime = localIso(cursor, TIME_WINDOW_START[template.timeWindow] || TIME_WINDOW_START.Afternoon);
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
  if (source.sourceType === "drupalViewsAjax") {
    return extractDrupalCardEvents(text, source, options);
  }
  if (source.sourceType === "eventList") {
    return extractEventListEvents(text, source, options);
  }
  if (source.sourceType === "officialTextEvents") {
    return extractOfficialTextEvents(text, source, options);
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
    const dateLine = blockLines.find((line) => parseDateTimeRange(line, options.now || new Date()));
    if (!dateLine && !parseDateTimeRange(blockLines.join(" "), options.now || new Date())) continue;
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
    const range = parseDateTimeRange(dateText, options.now || new Date());
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
    const startDateTime = datetimeFromBlock(block);
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

export function extractLibCalEvents(json, source = {}) {
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
        startDateTime: libCalDateTime(item.startdt),
        endDateTime: libCalDateTime(item.enddt),
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

function libCalDateTime(value) {
  const raw = stripUnsafeText(value, 80);
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})$/);
  if (match) return `${match[1]}T${match[2]}-07:00`;
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
      venue: item.venue?.name || item.location?.name || source.name,
      city: item.city || item.venue?.city || item.location?.address?.addressLocality || source.city,
      lat: item.lat || item.latitude || item.venue?.location?.latitude,
      lon: item.lon || item.longitude || item.venue?.location?.longitude,
      category: item.category || source.category,
      startDateTime: item.startDateTime || item.start || item.dates?.start?.dateTime,
      endDateTime: item.endDateTime || item.end || item.dates?.end?.dateTime,
      url: item.url || item.link,
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
      event.startDateTime ? event.startDateTime.slice(0, 10) : "",
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
  if (event.extractionMethod === "drupal-views-ajax") score += 7;
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
    generatedAt,
    source: {
      name: "Bay Area event source registry",
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
    if (cities.size > 0 && event.city && !cities.has(event.city)) {
      errors.push(`${prefix}.city '${event.city}' is outside configured coverage.`);
    }
    if (hasAdultOnlySignal(`${event.title} ${event.description || ""}`)) {
      errors.push(`${prefix} appears adult-only.`);
    }
  }
  return errors;
}
