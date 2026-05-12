#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildEventsDataset,
  decodeHtmlEntities,
  dedupeEvents,
  expandRecurringTemplates,
  extractEventsFromPayload,
  validateEventsDataset,
} from "./eventPipeline.mjs";
import {
  adultSourceRegistryPath,
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
  sourceRegistryPath,
} from "./metroConfig.mjs";

const metroConfig = loadMetroConfig();
const selection = selectedMetroFromArgs(process.argv.slice(2), metroConfig);
if (selection.all) {
  console.error("scripts/ingest-events.mjs expects one metro. Use npm run ingest:events:all.");
  process.exit(1);
}
const activeMetro = selection.metro;
const registryPath = process.env.EVENT_SOURCES || sourceRegistryPath(activeMetro);
const adultRegistryPath =
  process.env.EVENT_SOURCES_ADULTS ||
  adultSourceRegistryPath(activeMetro);
const templatePath =
  process.env.EVENT_TEMPLATE_INPUT ||
  activeMetro.eventTemplates ||
  null;
const manualEventsPath =
  process.env.EVENT_MANUAL_INPUT ||
  activeMetro.manualEvents ||
  null;
const outputPath = process.env.EVENT_OUTPUT || metroDataFile(activeMetro, "events");
const reportPath =
  process.env.EVENT_REPORT_OUTPUT || metroDataFile(activeMetro, "eventReport");
const minEvents = Number(process.env.MIN_EVENTS || activeMetro.minEvents || 25);
const timeoutMs = Number(process.env.EVENT_FETCH_TIMEOUT_MS || 12000);
const offline = process.env.EVENT_INGEST_OFFLINE === "1";

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  return JSON.parse(raw);
}

function templateMap(dataset) {
  const map = new Map();
  for (const event of dataset.events || []) {
    if (event?.id) map.set(event.id, event);
  }
  return map;
}

async function fetchSource(source, registry) {
  if (source.sourceType === "sfplEvents") {
    return fetchSfplEvents(source, registry);
  }
  if (source.sourceType === "communicoEvents") {
    return fetchCommunicoEvents(source, registry);
  }
  if (source.sourceType === "localistEvents") {
    return fetchLocalistEvents(source, registry);
  }
  if (source.sourceType === "drupalViewsAjax") {
    return fetchDrupalViewsAjax(source, registry);
  }
  if (source.sourceType === "libcal") {
    return fetchLibCal(source, registry);
  }
  if (source.sourceType === "ticketmaster") {
    const keyName = source.requiresEnv || "TICKETMASTER_API_KEY";
    const apiKey = process.env[keyName];
    if (!apiKey) {
      return { status: "skipped", reason: `missing ${keyName}` };
    }
    const now = new Date();
    const end = new Date(now.getTime() + Number(registry.defaults?.windowDays || 45) * 86400000);
    const url = new URL(source.url);
    url.searchParams.set("apikey", apiKey);
    url.searchParams.set("countryCode", "US");
    url.searchParams.set("classificationName", "Family");
    const lat = Number(source.lat);
    const lon = Number(source.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      url.searchParams.set("latlong", `${lat},${lon}`);
      url.searchParams.set("radius", String(source.radiusMiles || 50));
      url.searchParams.set("unit", "miles");
    } else {
      url.searchParams.set("city", source.city || "San Francisco");
    }
    url.searchParams.set("startDateTime", now.toISOString().replace(/\.\d{3}Z$/, "Z"));
    url.searchParams.set("endDateTime", end.toISOString().replace(/\.\d{3}Z$/, "Z"));
    url.searchParams.set("size", "100");
    return fetchUrl(url.toString(), registry.defaults?.userAgent, {
      browserHeaders: true,
      headers: { accept: "application/json" },
    });
  }
  return fetchUrl(source.url, registry.defaults?.userAgent, {
    browserHeaders: source.requiresBrowserHeaders === true,
  });
}

function shouldFetchSource(source) {
  if (source.enabled !== false) return true;
  if (source.sourceType !== "ticketmaster") return false;
  const keyName = source.requiresEnv || "TICKETMASTER_API_KEY";
  return Boolean(process.env[keyName]);
}

function dateParam(date) {
  return date.toISOString().slice(0, 10);
}

async function fetchSfplEvents(source, registry) {
  const audienceIds = Array.isArray(source.audienceIds) && source.audienceIds.length > 0
    ? source.audienceIds
    : [1082, 26, 27, 28, 29, 30];
  const itemsPerPage = Number(source.itemsPerPage || 50);
  const maxPages = Number(source.maxPages || 12);
  const now = new Date();
  const end = new Date(now.getTime() + Number(registry.defaults?.windowDays || 45) * 86400000);
  const chunks = [];
  let fetchedPages = 0;

  for (const audienceId of audienceIds) {
    for (let page = 0; page < maxPages; page += 1) {
      const url = new URL(source.url);
      url.searchParams.set("items_per_page", String(itemsPerPage));
      url.searchParams.set("field_event_audience_target_id", String(audienceId));
      url.searchParams.set("date-from", dateParam(now));
      url.searchParams.set("date-to", dateParam(end));
      url.searchParams.set("page", String(page));
      const payload = await fetchUrl(url.toString(), registry.defaults?.userAgent);
      if (payload.status !== "ok") return payload;
      const text = payload.text || "";
      if (!/\bevent--teaser\b/i.test(text)) break;
      chunks.push(`\n<!-- sfpl audience:${audienceId} page:${page} url:${url.toString()} -->\n${text}`);
      fetchedPages += 1;

      const resultMatch = text.match(/\b\d+\s+-\s+\d+\s+of\s+(\d+)\s+results\b/i);
      const totalResults = Number(resultMatch?.[1] || 0);
      if (!totalResults || (page + 1) * itemsPerPage >= totalResults) break;
    }
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `text/html; source=sfpl-events; pages=${fetchedPages}`,
    text: chunks.join("\n"),
  };
}

async function fetchCommunicoEvents(source, registry) {
  let client = source.communicoClient;
  if (!client) {
    try {
      client = new URL(source.url).hostname.split(".")[0];
    } catch {
      client = "";
    }
  }
  if (!client) {
    return { status: "fetch-error", reason: "missing Communico client" };
  }

  const now = new Date();
  const days = Number(source.communicoDays ?? Number(registry.defaults?.windowDays || 45) + 1);
  const request = {
    private: false,
    date: dateParam(now),
    days,
  };
  if (Array.isArray(source.communicoAges) && source.communicoAges.length > 0) {
    request.ages = source.communicoAges;
  }
  if (Array.isArray(source.communicoLocations) && source.communicoLocations.length > 0) {
    request.locations = source.communicoLocations;
  }

  const eventsUrl = new URL("/eeventcaldata", source.url);
  eventsUrl.searchParams.set("event_type", String(source.communicoEventType ?? 0));
  eventsUrl.searchParams.set("req", JSON.stringify(request));
  const eventsPayload = await fetchUrl(eventsUrl.toString(), registry.defaults?.userAgent);
  if (eventsPayload.status !== "ok") return eventsPayload;

  let events;
  try {
    events = Array.isArray(eventsPayload.json)
      ? eventsPayload.json
      : JSON.parse(eventsPayload.text || "[]");
  } catch (error) {
    return {
      status: "fetch-error",
      reason: `invalid Communico events response: ${
        error instanceof Error ? error.message : String(error)
      }`,
    };
  }

  let locations = [];
  const apiServer = source.communicoApiServer || "https://api.communico.co";
  const locationsUrl = new URL(`/v1/${client}/locations`, apiServer);
  const locationsPayload = await fetchUrl(locationsUrl.toString(), registry.defaults?.userAgent);
  if (locationsPayload.status === "ok") {
    try {
      locations = Array.isArray(locationsPayload.json)
        ? locationsPayload.json
        : JSON.parse(locationsPayload.text || "[]");
    } catch {
      locations = [];
    }
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `application/json; source=communico-events; events=${events.length}; locations=${locations.length}`,
    json: { events, locations },
    text: JSON.stringify({ events, locations }),
  };
}

async function fetchLocalistEvents(source, registry) {
  const days = Number(source.localistDays ?? registry.defaults?.windowDays ?? 45);
  const perPage = Number(source.localistPerPage || source.perPage || 100);
  const maxPages = Number(source.localistMaxPages || source.maxPages || 8);
  const eventTypeIds = Array.isArray(source.localistEventTypeIds)
    ? source.localistEventTypeIds
    : [];
  const events = [];
  let pageInfo = null;
  let fetchedPages = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(source.localistApiUrl || "/api/2/events", source.url);
    url.searchParams.set("days", String(days));
    url.searchParams.set("pp", String(perPage));
    url.searchParams.set("page", String(page));
    if (eventTypeIds.length > 1) {
      url.searchParams.set("match", source.localistMatch || "any");
    }
    eventTypeIds.forEach((id, index) => {
      url.searchParams.set(`type[${index}]`, String(id));
    });

    const payload = await fetchUrl(url.toString(), registry.defaults?.userAgent);
    if (payload.status !== "ok") return payload;
    let json = payload.json;
    if (!json) {
      try {
        json = JSON.parse(payload.text || "{}");
      } catch {
        return { status: "fetch-error", reason: "invalid Localist JSON response" };
      }
    }

    const pageEvents = Array.isArray(json.events) ? json.events : [];
    events.push(...pageEvents);
    pageInfo = json.page || pageInfo;
    fetchedPages += 1;

    const totalPages = Number(json.page?.total);
    if (pageEvents.length === 0 || (Number.isFinite(totalPages) && page >= totalPages)) {
      break;
    }
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `application/json; source=localist-events; events=${events.length}; pages=${fetchedPages}`,
    json: { events, page: pageInfo, fetchedPages },
    text: JSON.stringify({ events, page: pageInfo, fetchedPages }),
  };
}

async function fetchSourcePayloads(source, registry) {
  if (source.followEventLinks === true) {
    const landingPayload = await fetchSource(source, registry);
    const payloads = [{ ...landingPayload, url: source.url, source }];
    if (landingPayload.status !== "ok") return payloads;
    const links = extractOpenCitiesEventLinks(
      landingPayload.text || "",
      source.url,
      Number(source.maxEventLinks || 12),
    );
    for (const url of links) {
      const detailSource = {
        ...source,
        url,
        homeUrl: source.url,
        followEventLinks: false,
      };
      const payload = await fetchSource(detailSource, registry);
      payloads.push({ ...payload, url, source: detailSource });
    }
    return payloads;
  }

  let urls = Array.isArray(source.urls) && source.urls.length > 0
    ? source.urls
    : [source.url];
  // CivicPlus calendars render the current month at the unparameterized
  // base URL and accept `-curm-N/-cury-YYYY` suffixes. Append the next-month
  // URL so we cover the full planning window even at month-end. Generalized:
  // works for both /events/calendar-month-view (Sunnyvale) and /calendar/events
  // (Santa Clara City) and any other CivicPlus instance.
  if (source.sourceType === "civicpluscal" && !/-curm-\d/.test(source.url)) {
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nm = next.getUTCMonth() + 1;
    const ny = next.getUTCFullYear();
    const nextUrl = `${source.url.replace(/\/$/, "")}/-curm-${nm}/-cury-${ny}`;
    if (!urls.includes(nextUrl)) urls = [...urls, nextUrl];
  }
  const payloads = [];
  for (const url of urls) {
    const sourceForUrl = { ...source, url };
    const payload = await fetchSource(sourceForUrl, registry);
    payloads.push({ ...payload, url, source: sourceForUrl });
  }
  return payloads;
}

function extractOpenCitiesEventLinks(html, baseUrl, maxLinks) {
  const links = [];
  const seen = new Set();
  for (const match of html.matchAll(/<a[^>]+href=["']([^"']*Events-Directory[^"']+)["']/gi)) {
    const raw = decodeHtmlEntities(match[1]);
    let href;
    try {
      href = new URL(raw, baseUrl).toString();
    } catch {
      continue;
    }
    if (seen.has(href)) continue;
    seen.add(href);
    links.push(href);
    if (links.length >= maxLinks) break;
  }
  return links;
}

async function fetchLibCal(source, registry) {
  const calendarId = source.libcalCalendarId || extractQueryParam(source.url, "cal") || extractQueryParam(source.url, "cid");
  if (!calendarId) {
    return { status: "fetch-error", reason: "missing LibCal calendar id" };
  }
  const perPage = Number(source.perPage || 100);
  const maxPages = Number(source.maxPages || 5);
  const results = [];
  let totalResults = null;
  let contentType = "application/json";
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL("/ajax/calendar/list", source.url);
    url.searchParams.set("c", String(calendarId));
    url.searchParams.set("date", "0000-00-00");
    url.searchParams.set("perpage", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("audience", "");
    url.searchParams.set("cats", "");
    url.searchParams.set("camps", "");
    url.searchParams.set("inc", String(source.includeExternalEvents ?? 0));
    const payload = await fetchUrl(url.toString(), registry.defaults?.userAgent);
    if (payload.status !== "ok") return payload;
    contentType = payload.contentType || contentType;
    const json = payload.json || JSON.parse(payload.text || "{}");
    totalResults = Number(json.total_results || totalResults || 0);
    const pageResults = Array.isArray(json.results) ? json.results : [];
    results.push(...pageResults);
    if (results.length >= totalResults || pageResults.length === 0) break;
  }
  return {
    status: "ok",
    httpStatus: 200,
    contentType,
    json: { results, total_results: totalResults ?? results.length },
    text: JSON.stringify({ results }),
  };
}

async function fetchDrupalViewsAjax(source, registry) {
  const config = source.drupalViews || {};
  const ajaxUrl = config.ajaxUrl || new URL("/views/ajax", source.url).toString();
  const baseParams = {
    view_name: config.viewName,
    view_display_id: config.viewDisplayId,
    view_args: config.viewArgs || "",
    view_path: config.viewPath || new URL(source.url).pathname,
  };
  if (!baseParams.view_name || !baseParams.view_display_id) {
    return { status: "fetch-error", reason: "missing Drupal Views config" };
  }

  const requests = Array.isArray(config.requests) && config.requests.length > 0
    ? config.requests
    : [{ label: "default", params: config.params || {} }];
  const maxPages = Number(config.maxPages || 1);
  const chunks = [];

  for (const request of requests) {
    const requestParams = request.params || {};
    for (let page = 0; page < maxPages; page += 1) {
      const body = new URLSearchParams({
        ...baseParams,
        ...requestParams,
        page: String(page),
      });
      const payload = await fetchUrl(ajaxUrl, registry.defaults?.userAgent, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
        },
        body: body.toString(),
      });
      if (payload.status !== "ok") return payload;

      let commands = [];
      try {
        commands = parseDrupalAjaxCommands(payload);
      } catch (error) {
        return {
          status: "fetch-error",
          reason: `invalid Drupal Views AJAX response: ${
            error instanceof Error ? error.message : String(error)
          }`,
        };
      }
      const html = Array.isArray(commands)
        ? commands
            .filter((command) => command.command === "insert" && typeof command.data === "string")
            .map((command) => command.data)
            .join("\n")
        : "";
      if (!html || !/collection-card--event/i.test(html)) break;
      chunks.push(`\n<!-- drupal-request:${request.label || "default"} page:${page} -->\n${html}`);
    }
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: "text/html; source=drupal-views-ajax",
    text: chunks.join("\n"),
  };
}

function parseDrupalAjaxCommands(payload) {
  if (payload.json) return payload.json;
  let raw = payload.text || "[]";
  const textarea = raw.match(/<textarea[^>]*>([\s\S]*?)<\/textarea>/i);
  if (textarea) {
    raw = decodeHtmlEntities(textarea[1]);
  }
  return JSON.parse(raw.trim() || "[]");
}

function extractQueryParam(url, key) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get(key);
  } catch {
    return null;
  }
}

// Sites behind Akamai / Imperva (e.g. Sunnyvale Library) reject the default
// fetcher's headers with 403. When the source asks for it, send the full
// Chrome header set including Sec-Fetch-* — that is enough to clear most
// "definitely not a real browser" heuristics without resorting to TLS
// fingerprint spoofing.
const BROWSER_HEADERS = {
  "user-agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
  accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "accept-language": "en-US,en;q=0.9",
  "cache-control": "no-cache",
  pragma: "no-cache",
  referer: "https://www.google.com/",
  "sec-ch-ua": '"Chromium";v="130", "Google Chrome";v="130"',
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": '"macOS"',
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
};

async function fetchUrl(url, userAgent, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const useBrowserHeaders = Boolean(init.browserHeaders);
    const baseHeaders = useBrowserHeaders
      ? { ...BROWSER_HEADERS }
      : {
          accept:
            "text/html,application/xhtml+xml,application/json,application/rss+xml,application/xml,text/calendar;q=0.9,*/*;q=0.8",
          "user-agent": userAgent || "saturday-with-friends/0.1 event-ingest",
        };
    const { browserHeaders: _omit, ...passthroughInit } = init;
    const response = await fetch(url, {
      ...passthroughInit,
      signal: controller.signal,
      headers: {
        ...baseHeaders,
        ...(passthroughInit.headers || {}),
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
    if (response.ok && /incapsula|imperva|hcaptcha|additional security check|captcha challenge/i.test(text)) {
      return {
        status: "blocked",
        reason: "challenge page returned instead of event content",
        httpStatus: response.status,
        contentType,
        text,
        json: null,
      };
    }
    let json = null;
    if (/json/i.test(contentType)) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return {
      status: response.ok ? "ok" : "http-error",
      httpStatus: response.status,
      contentType,
      text,
      json,
    };
  } catch (error) {
    return {
      status: "fetch-error",
      reason: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

function fallbackTemplates(source, templates, registry, now) {
  const ids = Array.isArray(source.fallbackEventIds) ? source.fallbackEventIds : [];
  const selected = ids.map((id) => templates.get(id)).filter(Boolean);
  return expandRecurringTemplates(selected, source, {
    now,
    windowDays: registry.defaults?.windowDays || 45,
    maxOccurrencesPerTemplate: 4,
  });
}

function filterToPlanningWindow(events, generatedAt, windowDays) {
  const generated = new Date(generatedAt);
  const start = new Date(Date.UTC(
    generated.getUTCFullYear(),
    generated.getUTCMonth(),
    generated.getUTCDate(),
  ));
  const end = new Date(start.getTime() + Number(windowDays || 45) * 86400000);
  return events.filter((event) => {
    if (!event.startDateTime) return false;
    const date = new Date(event.startDateTime);
    if (!Number.isFinite(date.getTime())) return false;
    return date >= start && date <= end;
  });
}

async function readJsonOrEmpty(filePath) {
  if (!filePath) return null;
  try {
    return await readJson(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

// If a registry sets defaults.audiences, copy that down to every source that
// didn't already declare its own. resolveAudiences() in eventPipeline.mjs then
// reads source.audiences and tags each emitted event accordingly.
function applyDefaultAudiences(reg) {
  const def = reg?.defaults?.audiences;
  if (!Array.isArray(def) || def.length === 0 || !Array.isArray(reg?.sources)) {
    return;
  }
  for (const s of reg.sources) {
    if (!Array.isArray(s.audiences) || s.audiences.length === 0) {
      s.audiences = def.slice();
    }
  }
}

function applyRegistryDefaults(reg, metro = activeMetro) {
  applyDefaultAudiences(reg);
  if (!reg || !Array.isArray(reg.sources)) return;
  const timezoneOffset = reg.defaults?.timezoneOffset || metro.timezoneOffset;
  if (timezoneOffset) {
    for (const source of reg.sources) {
      if (!source.timezoneOffset) source.timezoneOffset = timezoneOffset;
    }
  }
  for (const source of reg.sources) {
    if (!source.metroId) source.metroId = metro.id;
  }
}

async function main() {
  const registry = await readJson(registryPath);
  const adultRegistry = await readJsonOrEmpty(adultRegistryPath);
  applyRegistryDefaults(registry);
  applyRegistryDefaults(adultRegistry);
  const templateDataset = templatePath ? await readJson(templatePath) : { events: [] };
  const templates = templateMap(templateDataset);
  const manualDataset = await readJsonOrEmpty(manualEventsPath);
  const generatedAt = new Date().toISOString();
  const allEvents = [];
  const sourceReports = [];

  const registriesToProcess = [registry];
  if (Array.isArray(adultRegistry?.sources) && adultRegistry.sources.length > 0) {
    registriesToProcess.push(adultRegistry);
  }

  // Hand-entered one-off events (manual-events.json). Filtered to the
  // planning window so a stale entry doesn't stick around forever.
  if (manualDataset?.events?.length) {
    const windowDays = registry.defaults?.windowDays || 45;
    const inWindow = filterToPlanningWindow(
      manualDataset.events,
      generatedAt,
      windowDays,
    );
    let manualCount = 0;
    for (const event of inWindow) {
      allEvents.push({
        ...event,
        metroId: event.metroId || activeMetro.id,
        sourceId: event.sourceId || "manual",
        sourceName: event.sourceName || "Manual entry",
        sourceUrl: event.sourceUrl || event.url,
        sourceMode: event.sourceMode || "manual",
        extractionMethod: event.extractionMethod || "manual",
        fetchedAt: generatedAt,
      });
      manualCount += 1;
    }
    sourceReports.push({
      id: "manual",
      name: "Manual entries",
      url: manualEventsPath,
      sourceType: "manual",
      city: null,
      metroId: activeMetro.id,
      category: null,
      status: "ok",
      liveEvents: manualCount,
      fallbackEvents: 0,
      eventCount: manualCount,
      fetches: [],
    });
  }

  for (const reg of registriesToProcess) {
  for (const source of reg.sources || []) {
    const fetchEnabled = shouldFetchSource(source);
    if (!fetchEnabled) {
      sourceReports.push({
        id: source.id,
        name: source.name,
        url: source.url,
        sourceType: source.sourceType || "html",
        city: source.city,
        metroId: activeMetro.id,
        category: source.category,
        status: "disabled",
        reason: source.disabledReason || source.notes,
        liveEvents: 0,
        fallbackEvents: 0,
        eventCount: 0,
        fetches: [],
      });
      continue;
    }
    const report = {
      id: source.id,
      name: source.name,
      url: source.url,
      sourceType: source.sourceType || "html",
      city: source.city,
      metroId: activeMetro.id,
      category: source.category,
      status: "pending",
      liveEvents: 0,
      fallbackEvents: 0,
      eventCount: 0,
      fetches: [],
    };
    if (!fetchEnabled && (source.disabledReason || source.notes)) {
      report.reason = source.disabledReason || source.notes;
    }
    let liveEvents = [];

    if (!offline && fetchEnabled) {
      const payloads = await fetchSourcePayloads(source, reg);
      report.fetches = payloads.map((payload) => ({
        url: payload.url,
        status: payload.status,
        reason: payload.reason,
        httpStatus: payload.httpStatus,
        contentType: payload.contentType,
      }));
      const firstOk = payloads.find((payload) => payload.status === "ok");
      const firstPayload = firstOk || payloads[0] || {};
      report.status = firstPayload.status || "fetch-error";
      if (firstPayload.reason) report.reason = firstPayload.reason;
      if (firstPayload.httpStatus) report.httpStatus = firstPayload.httpStatus;
      if (firstPayload.contentType) report.contentType = firstPayload.contentType;
      if (firstOk) {
        const extracted = payloads
          .filter((payload) => payload.status === "ok")
          .flatMap((payload) => extractEventsFromPayload(
            payload,
            payload.source || source,
            {
              now: new Date(generatedAt),
              windowDays: reg.defaults?.windowDays || 45,
            },
          ));
        liveEvents = dedupeEvents(filterToPlanningWindow(
          extracted,
          generatedAt,
          reg.defaults?.windowDays || 45,
        ));
        report.rejectedLiveEvents = extracted.length - liveEvents.length;
      }
    } else {
      report.status = source.enabled === false ? "disabled" : "offline";
    }

    const fallbackEvents =
      liveEvents.length > 0 ? [] : fallbackTemplates(source, templates, reg, generatedAt);
    for (const event of [...liveEvents, ...fallbackEvents]) {
      allEvents.push({
        ...event,
        metroId: event.metroId || activeMetro.id,
        sourceId: event.sourceId || source.id,
        sourceName: event.sourceName || source.name,
        sourceUrl: event.sourceUrl || source.url,
        fetchedAt: generatedAt,
      });
    }
    report.liveEvents = liveEvents.length;
    report.fallbackEvents = fallbackEvents.length;
    report.eventCount = liveEvents.length + fallbackEvents.length;
    if (report.status === "ok" && liveEvents.length === 0 && fallbackEvents.length > 0) {
      report.status = "ok-template-fallback";
    }
    sourceReports.push(report);
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.EVENT_FETCH_DELAY_MS || 100)));
  }
  }

  // Union the city allowlists across registries — adults coverage may extend
  // beyond the kid registry (e.g., late-night neighborhoods or breweries).
  const unionCities = new Set(registry.coverage?.cities || []);
  for (const c of adultRegistry?.coverage?.cities || []) unionCities.add(c);

  const dataset = buildEventsDataset(allEvents, {
    metroId: activeMetro.id,
    generatedAt,
    registryPath,
    sourceName: `${activeMetro.label} event source registry`,
    coverage: { ...registry.coverage, cities: Array.from(unionCities) },
    sourceCount:
      (registry.sources || []).length + (adultRegistry?.sources || []).length,
  });
  const errors = validateEventsDataset(dataset, {
    minEvents,
    cities: Array.from(unionCities),
    communities: [
      registry.coverage?.name,
      activeMetro.label,
      activeMetro.seoName,
      ...(activeMetro.eventCommunities || []),
    ].filter(Boolean),
    bbox: activeMetro.spotCoverage?.bbox,
  });

  const report = {
    schemaVersion: 1,
    metroId: activeMetro.id,
    generatedAt,
    registryPath,
    outputPath,
    eventCount: dataset.events.length,
    sourceCount: sourceReports.length,
    liveEventCount: sourceReports.reduce((sum, item) => sum + item.liveEvents, 0),
    fallbackEventCount: sourceReports.reduce((sum, item) => sum + item.fallbackEvents, 0),
    errors,
    sources: sourceReports,
  };

  if (errors.length > 0) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    throw new Error(`Generated events failed validation:\n${errors.join("\n")}`);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
  const legacyOutput = legacyMetroDataFile(activeMetro, "events");
  if (legacyOutput) {
    await fs.mkdir(path.dirname(legacyOutput), { recursive: true });
    await fs.writeFile(legacyOutput, `${JSON.stringify(dataset, null, 2)}\n`);
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  const legacyReport = legacyMetroDataFile(activeMetro, "eventReport");
  if (legacyReport) {
    await fs.mkdir(path.dirname(legacyReport), { recursive: true });
    await fs.writeFile(legacyReport, `${JSON.stringify(report, null, 2)}\n`);
  }
  console.log(
    `Wrote ${dataset.events.length} events to ${outputPath} (${report.liveEventCount} live, ${report.fallbackEventCount} template).`,
  );
  console.log(`Wrote event build report to ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
