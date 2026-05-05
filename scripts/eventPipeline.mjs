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
  "demo",
  "event",
  "family",
  "kids",
  "lego",
  "maker",
  "nature",
  "program",
  "science",
  "story",
  "storytime",
  "toddler",
  "walk",
  "workshop",
];

const FAMILY_TERMS = [
  "baby",
  "camp",
  "children",
  "craft",
  "family",
  "kids",
  "lego",
  "maker",
  "preschool",
  "school age",
  "school-age",
  "storytime",
  "teen",
  "toddler",
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
  /\bmission & history\b/i,
  /\bhours of operation\b/i,
  /\bin progress\b/i,
];

const CATEGORY_BY_TEXT = [
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
  if (/\b(baby|babies|infant|toddler|0-3|0 - 3|ages 0|age 0|lapsit)\b/.test(lower)) {
    bands.add("toddler");
  }
  if (/\b(preschool|pre-k|pre k|ages 3|age 3|ages 4|age 4|ages 5|age 5|0-5|0 - 5)\b/.test(lower)) {
    bands.add("preschool");
  }
  if (/\b(camp|kids|school age|school-age|grades?\s+k|grades?\s+[1-5]|ages 6|ages 7|ages 8|ages 9|ages 10|elementary|lego|maker|craft|youth)\b/.test(lower)) {
    bands.add("school-age");
  }
  if (/\b(tween|tweens|teen|teens|ages 10|ages 11|ages 12|ages 13|middle school|code club)\b/.test(lower)) {
    bands.add("tween");
  }
  if (bands.size === 0 && /\bfamily|all ages|children|kids\b/.test(lower)) {
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
        events.push(normalizeRawEvent({
          title: item.name,
          description: item.description,
          venue: item.location?.name || source.name,
          city: item.location?.address?.addressLocality || source.city,
          lat: item.location?.geo?.latitude,
          lon: item.location?.geo?.longitude,
          category: source.category || inferCategory(`${item.name} ${item.description}`),
          startDateTime: item.startDate,
          endDateTime: item.endDate,
          url: item.url,
          cost: item.isAccessibleForFree === true ? "Free" : inferCost(`${item.name} ${item.description}`),
          sourceId: source.id,
          sourceName: source.name,
          sourceUrl: source.url,
          extractionMethod: "json-ld",
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
    if (!isEventish(text) || hasAdultOnlySignal(text)) continue;
    if (!hasFamilySignal(text)) continue;
    const startDateTime = datetimeFromBlock(block) || parseLooseDate(text, options.now || new Date());
    if (!startDateTime) continue;
    const links = hrefsFromBlock(block, source.url);
    const title = bestTitleFromBlock(block, links, text);
    if (!title) continue;
    const ageBands = inferAgeBands(`${title} ${text.slice(0, 500)}`);
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
  if (event.extractionMethod === "json-ld") score += 8;
  if (event.extractionMethod === "ics") score += 7;
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
