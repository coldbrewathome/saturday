#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildEventsDataset,
  decodeHtmlEntities,
  dedupeEvents,
  expandRecurringTemplates,
  extractEventsFromPayload,
  updateSlugHistory,
  validateEventsDataset,
} from "./eventPipeline.mjs";
import {
  ROOT,
  adultSourceRegistryPath,
  legacyMetroDataFile,
  loadMetroConfig,
  metroDataFile,
  selectedMetroFromArgs,
  sourceRegistryPath,
} from "./metroConfig.mjs";
import {
  buildOperatorAlert,
  collectPreviousEvents,
  lastKnownGoodEventsForSource,
} from "./eventSourceRecovery.mjs";
import {
  activeSnoozeMap,
  annotateAlertsWithSnoozes,
  readSnoozesFile,
} from "./alertSnoozes.mjs";

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
const alertsPath =
  process.env.EVENT_ALERTS_OUTPUT ||
  reportPath.replace(/event-build-report\.json$/, "event-operator-alerts.json");
const slugHistoryPath =
  process.env.EVENT_SLUG_HISTORY_OUTPUT ||
  path.join("data", activeMetro.dataDir || activeMetro.id, "event-slug-history.json");
const minEvents = Number(process.env.MIN_EVENTS || activeMetro.minEvents || 25);
const timeoutMs = Number(process.env.EVENT_FETCH_TIMEOUT_MS || 12000);
const offline = process.env.EVENT_INGEST_OFFLINE === "1";
let browserInstance = null;

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
  if (source.sourceType === "nextDataEvents") {
    return fetchNextDataEvents(source, registry);
  }
  if (source.sourceType === "tribeEvents") {
    return fetchTribeEvents(source, registry);
  }
  if (source.sourceType === "libraryMarket") {
    return fetchLibraryMarket(source, registry);
  }
  if (source.sourceType === "dallasZooAjax") {
    return fetchDallasZooAjax(source, registry);
  }
  if (source.sourceType === "miamiDadeCalendar") {
    return fetchMiamiDadeCalendar(source, registry);
  }
  if (source.sourceType === "phoenixCityCalendar") {
    return fetchPhoenixCityCalendar(source, registry);
  }
  if (source.sourceType === "cmaProgramEvents") {
    return fetchCmaProgramEvents(source, registry);
  }
  if (source.sourceType === "nationalZooJsonApi") {
    return fetchNationalZooJsonApi(source, registry);
  }
  if (source.sourceType === "sanDiegoDrupalCalendar") {
    return fetchSanDiegoDrupalCalendar(source, registry);
  }
  if (source.sourceType === "wpRestEvents") {
    return fetchWpRestEvents(source, registry);
  }
  if (source.sourceType === "wwcEvents") {
    return fetchWwcEvents(source, registry);
  }
  if (source.sourceType === "eventOnEvents") {
    return fetchEventOnEvents(source, registry);
  }
  if (source.sourceType === "ticketureEvents") {
    return fetchTicketureEvents(source, registry);
  }
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
    const end = new Date(now.getTime() + Number(source.windowDays || registry.defaults?.windowDays || 45) * 86400000);
    const queries = Array.isArray(source.ticketmasterQueries) && source.ticketmasterQueries.length > 0
      ? source.ticketmasterQueries
      : [{ classificationName: "Family" }];
    const eventsById = new Map();
    let fetched = 0;
    for (const query of queries) {
      const url = new URL(source.url);
      url.searchParams.set("apikey", apiKey);
      url.searchParams.set("countryCode", "US");
      for (const [key, value] of Object.entries(query || {})) {
        if (value !== null && value !== undefined && value !== "") {
          url.searchParams.set(key, String(value));
        }
      }
      if (!url.searchParams.has("classificationName") && !url.searchParams.has("segmentName") && !url.searchParams.has("keyword")) {
        url.searchParams.set("classificationName", "Family");
      }
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
      url.searchParams.set("size", String(source.ticketmasterPageSize || 100));
      const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
        browserHeaders: true,
        headers: { accept: "application/json" },
      });
      if (payload.status !== "ok") return payload;
      const json = payload.json || JSON.parse(payload.text || "{}");
      for (const event of json?._embedded?.events || []) {
        const key = event.id || `${event.name}|${event.dates?.start?.dateTime || event.dates?.start?.localDate || ""}`;
        eventsById.set(key, event);
      }
      fetched += 1;
    }
    const json = { _embedded: { events: [...eventsById.values()] } };
    return {
      status: "ok",
      httpStatus: 200,
      contentType: `application/json; source=ticketmaster; events=${eventsById.size}; queries=${fetched}`,
      json,
      text: JSON.stringify(json),
    };
  }
  return fetchUrlForSource(source, source.url, registry.defaults?.userAgent, {
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

async function fetchNextDataEvents(source, registry) {
  const pagePayload = await fetchUrlForSource(source, source.url, registry.defaults?.userAgent, {
    browserHeaders: true,
  });
  if (pagePayload.status !== "ok") return pagePayload;
  const rawJson = pagePayload.text?.match(/<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i)?.[1];
  if (!rawJson) return { status: "fetch-error", reason: "missing __NEXT_DATA__ payload" };

  let nextData;
  try {
    nextData = JSON.parse(decodeHtmlEntities(rawJson));
  } catch (error) {
    return {
      status: "fetch-error",
      reason: `invalid __NEXT_DATA__ payload: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  const buildId = nextData.buildId || source.buildId;
  if (!buildId || source.inlineNextData === true) {
    return {
      status: "ok",
      httpStatus: 200,
      contentType: "application/json; source=next-data-inline",
      json: nextData,
      text: JSON.stringify(nextData),
    };
  }

  const pageUrl = new URL(source.url);
  const dataUrl = new URL(
    `/_next/data/${buildId}${pageUrl.pathname.replace(/\/$/, "") || "/index"}.json`,
    source.url,
  );
  const dataPayload = await fetchUrlForSource(source, dataUrl.toString(), registry.defaults?.userAgent, {
    headers: { accept: "application/json" },
  });
  if (dataPayload.status === "ok" && dataPayload.json) return dataPayload;
  return {
    status: "ok",
    httpStatus: 200,
    contentType: "application/json; source=next-data-inline",
    json: nextData,
    text: JSON.stringify(nextData),
  };
}

async function fetchTribeEvents(source, registry) {
  const perPage = Number(source.perPage || 100);
  const maxPages = Number(source.maxPages || 12);
  const now = new Date();
  const baseUrl = new URL(source.apiUrl || "/wp-json/tribe/events/v1/events", source.url);
  const events = [];
  let totalPages = null;
  let fetchedPages = 0;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(baseUrl);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("status", "publish");
    url.searchParams.set("start_date", source.startDate || dateParam(now));
    if (source.endDate) url.searchParams.set("end_date", source.endDate);
    if (source.categories) url.searchParams.set("categories", String(source.categories));
    const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
      headers: { accept: "application/json" },
    });
    if (payload.status !== "ok") return payload;
    const json = payload.json || JSON.parse(payload.text || "{}");
    const pageEvents = Array.isArray(json.events) ? json.events : [];
    events.push(...pageEvents);
    totalPages = Number(json.total_pages || totalPages || 0) || null;
    fetchedPages += 1;
    if (pageEvents.length === 0 || (totalPages && page >= totalPages)) break;
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `application/json; source=tribe-events; events=${events.length}; pages=${fetchedPages}`,
    json: { events, total_pages: totalPages, fetchedPages },
    text: JSON.stringify({ events, total_pages: totalPages, fetchedPages }),
  };
}

async function fetchLibraryMarket(source, registry) {
  const maxPages = Number(source.maxPages || 12);
  const chunks = [];
  let fetchedPages = 0;

  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(source.url);
    url.searchParams.set("page", String(page));
    const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
      browserHeaders: source.requiresBrowserHeaders === true,
    });
    if (payload.status !== "ok") return payload;
    const text = payload.text || "";
    if (!/\blc-event\b/i.test(text)) break;
    chunks.push(`\n<!-- library-market-page:${page} url:${url.toString()} -->\n${text}`);
    fetchedPages += 1;
    if (!/pager__item--next|rel=["']next["']|\?page=\d+/i.test(text) && page > 0) break;
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `text/html; source=library-market; pages=${fetchedPages}`,
    text: chunks.join("\n"),
  };
}

async function fetchDallasZooAjax(source, registry) {
  const maxPages = Number(source.maxPages || 8);
  const start = source.startDate || dateParam(new Date());
  const end = source.endDate || "2099-12-31";
  const chunks = [];
  let totalPages = null;

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(source.apiUrl || "/wp-admin/admin-ajax.php", source.url);
    url.searchParams.set("action", "ajax_calendar_populate");
    url.searchParams.set("page", String(page));
    url.searchParams.set("start", start);
    url.searchParams.set("end", end);
    url.searchParams.set("tags", source.tags || "");
    const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
      browserHeaders: true,
      headers: {
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "x-requested-with": "XMLHttpRequest",
      },
    });
    if (payload.status !== "ok") return payload;
    const json = payload.json || JSON.parse(payload.text || "{}");
    const html = json?.data?.html || "";
    if (!html) break;
    chunks.push(`\n<!-- dallas-zoo-page:${page} -->\n${html}`);
    totalPages = Number(json?.data?.totalPages || totalPages || 0) || null;
    if (totalPages && page >= totalPages) break;
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `text/html; source=dallas-zoo-ajax; pages=${chunks.length}`,
    text: chunks.join("\n"),
  };
}

async function fetchMiamiDadeCalendar(source, registry) {
  const calendarName = source.calendarName || "Parks";
  const url = source.apiUrl || `https://api2.miamidade.gov/calendar/api/calendars/${encodeURIComponent(calendarName)}/events`;
  return fetchUrlForSource(source, url, registry.defaults?.userAgent, {
    headers: { accept: "application/json" },
  });
}

async function fetchPhoenixCityCalendar(source, registry) {
  const limit = Number(source.limit || 50);
  const maxPages = Number(source.maxPages || 8);
  const endpoints = Array.isArray(source.apiUrls) && source.apiUrls.length > 0
    ? source.apiUrls
    : [source.apiUrl || source.url];
  const results = [];
  let resultTotal = 0;

  for (const endpoint of endpoints) {
    for (let offset = 0; offset < maxPages * limit; offset += limit) {
      const url = new URL(endpoint);
      url.searchParams.set("offset", String(offset));
      url.searchParams.set("limit", String(limit));
      if (source.searchDateStart) url.searchParams.set("search-date-start", source.searchDateStart);
      const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
        headers: { accept: "application/json" },
      });
      if (payload.status !== "ok") return payload;
      const json = payload.json || JSON.parse(payload.text || "{}");
      const pageResults = Array.isArray(json.results) ? json.results : [];
      results.push(...pageResults);
      const total = Number(json.resultTotal || json.total || 0);
      if (offset === 0 && Number.isFinite(total)) resultTotal += total;
      if (pageResults.length === 0 || (Number.isFinite(total) && offset + pageResults.length >= total)) break;
    }
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `application/json; source=phoenix-city-calendar; events=${results.length}`,
    json: { results, resultTotal },
    text: JSON.stringify({ results, resultTotal }),
  };
}

async function fetchCmaProgramEvents(source, registry) {
  const url = new URL(source.apiUrl || "/wp-json/CMAProgViewerApi/v1/cma-program-api-list", source.url);
  return fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
    },
    body: JSON.stringify({ date: source.startDate || dateParam(new Date()) }),
  });
}

async function fetchNationalZooJsonApi(source, registry) {
  const limit = Number(source.pageLimit || 50);
  const maxPages = Number(source.maxPages || 4);
  const data = [];
  let included = [];
  for (let page = 0; page < maxPages; page += 1) {
    const url = new URL(source.apiUrl || "/jsonapi/node/event", source.url);
    url.searchParams.set("page[limit]", String(limit));
    url.searchParams.set("page[offset]", String(page * limit));
    url.searchParams.set("sort", source.sort || "field_event_date_time.value");
    url.searchParams.set("filter[status]", "1");
    const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
      headers: { accept: "application/vnd.api+json,application/json" },
    });
    if (payload.status !== "ok") return payload;
    const json = payload.json || JSON.parse(payload.text || "{}");
    const pageData = Array.isArray(json.data) ? json.data : [];
    data.push(...pageData);
    if (Array.isArray(json.included)) included = included.concat(json.included);
    if (pageData.length < limit) break;
  }
  return {
    status: "ok",
    httpStatus: 200,
    contentType: `application/vnd.api+json; source=national-zoo-jsonapi; events=${data.length}`,
    json: { data, included },
    text: JSON.stringify({ data, included }),
  };
}

async function fetchWpRestEvents(source, registry) {
  const perPage = Number(source.perPage || 100);
  const maxPages = Number(source.maxPages || 4);
  const events = [];
  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(source.apiUrl || "/wp-json/wp/v2/events", source.url);
    url.searchParams.set("per_page", String(perPage));
    url.searchParams.set("page", String(page));
    url.searchParams.set("status", "publish");
    if (source.embed !== false) url.searchParams.set("_embed", "1");
    if (source.fields) url.searchParams.set("_fields", String(source.fields));
    const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
      headers: { accept: "application/json" },
    });
    if (payload.status !== "ok") return payload;
    const json = payload.json || JSON.parse(payload.text || "[]");
    const pageEvents = Array.isArray(json) ? json : [];
    events.push(...pageEvents);
    if (pageEvents.length < perPage) break;
  }
  return {
    status: "ok",
    httpStatus: 200,
    contentType: `application/json; source=wp-rest-events; events=${events.length}`,
    json: events,
    text: JSON.stringify(events),
  };
}

async function fetchWwcEvents(source, registry) {
  const limit = Number(source.limit || source.perPage || 8);
  const maxPages = Number(source.maxPages || 3);
  const items = [];
  let fetchedPages = 0;

  for (let page = 0; page < maxPages * limit; page += limit) {
    const url = new URL(source.apiUrl || "/wp-json/discover/v1/events/", source.url);
    const body = new URLSearchParams({
      series: String(source.wwcSeries || "all"),
      category: String(source.wwcCategory || source.categoryId || "all"),
      query: String(source.wwcQuery || "all"),
      limit: String(limit),
      initcount: String(source.wwcInitCount || ""),
      page: String(page),
      group: String(source.wwcGroup || ""),
      displaytype: String(source.wwcDisplayType || "list"),
    });

    const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
      method: "POST",
      browserHeaders: source.requiresBrowserHeaders === true,
      headers: {
        accept: "application/json,text/html;q=0.9,*/*;q=0.8",
        "content-type": "application/x-www-form-urlencoded",
        "x-requested-with": "XMLHttpRequest",
      },
      body: body.toString(),
    });
    if (payload.status !== "ok") return payload;

    let json = payload.json;
    if (!json) {
      try {
        json = JSON.parse(payload.text || "{}");
      } catch {
        return { status: "fetch-error", reason: "invalid WWC events response" };
      }
    }

    const pageItems = Array.isArray(json.items) ? json.items : [];
    items.push(...pageItems);
    fetchedPages += 1;
    if (pageItems.length === 0 || pageItems.length < limit) break;
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: `text/html; source=wwc-events; events=${items.length}; pages=${fetchedPages}`,
    json: { items, fetchedPages },
    text: items.join("\n"),
  };
}

function extractEventOnConfig(html) {
  const scMatch =
    html.match(/class=["'][^"']*evo_cal_data[^"']*["'][^>]*data-sc=(["'])([\s\S]*?)\1/i) ||
    html.match(/data-sc=(["'])([\s\S]*?)\1[^>]*class=["'][^"']*evo_cal_data[^"']*["']/i);
  const paramsMatch = html.match(/var\s+evo_general_params\s*=\s*({[\s\S]*?});/);
  let shortcode = null;
  let params = null;

  if (scMatch) {
    try {
      shortcode = JSON.parse(decodeHtmlEntities(scMatch[2]));
    } catch {
      shortcode = null;
    }
  }
  if (paramsMatch) {
    try {
      params = JSON.parse(paramsMatch[1]);
    } catch {
      params = null;
    }
  }

  return { shortcode, params };
}

function appendNestedForm(body, key, value) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => appendNestedForm(body, `${key}[${index}]`, item));
    return;
  }
  if (typeof value === "object") {
    for (const [childKey, childValue] of Object.entries(value)) {
      appendNestedForm(body, key ? `${key}[${childKey}]` : childKey, childValue);
    }
    return;
  }
  body.append(key, String(value));
}

async function fetchEventOnEvents(source, registry) {
  const pagePayload = await fetchUrlForSource(source, source.url, registry.defaults?.userAgent, {
    browserHeaders: source.requiresBrowserHeaders === true,
  });
  if (pagePayload.status !== "ok") return pagePayload;

  const { shortcode, params } = extractEventOnConfig(pagePayload.text || "");
  if (!shortcode) {
    return { status: "fetch-error", reason: "missing EventON shortcode config" };
  }

  const ajaxUrl = source.apiUrl || params?.ajaxurl || new URL("/wp-admin/admin-ajax.php", source.url).toString();
  const body = new URLSearchParams();
  body.set("action", source.eventOnAction || "eventon_get_events");
  body.set("direction", source.eventOnDirection || "none");
  appendNestedForm(body, "shortcode", shortcode);
  body.set("ajaxtype", source.eventOnAjaxType || "initial");
  if (params?.n) body.set("nonce", params.n);
  if (params?.nonce) body.set("nonceX", params.nonce);

  const headers = {
    accept: "application/json,text/javascript,*/*;q=0.01",
    "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
    "x-requested-with": "XMLHttpRequest",
  };
  if (params?.nonce) headers["x-wp-nonce"] = params.nonce;

  const payload = await fetchUrlForSource(source, ajaxUrl, registry.defaults?.userAgent, {
    method: "POST",
    browserHeaders: source.requiresBrowserHeaders === true,
    headers,
    body: body.toString(),
  });
  if (payload.status !== "ok") return payload;

  let json = payload.json;
  if (!json) {
    try {
      json = JSON.parse(payload.text || "{}");
    } catch {
      return { status: "fetch-error", reason: "invalid EventON response" };
    }
  }

  const records = Array.isArray(json?.json) ? json.json : [];
  return {
    status: "ok",
    httpStatus: payload.httpStatus,
    contentType: `application/json; source=eventon-events; events=${records.length}`,
    json,
    text: JSON.stringify(json),
  };
}

function ticketureUrl(source, pathName) {
  const base = source.ticketureBaseUrl || source.apiUrl || source.url;
  return new URL(pathName, base).toString();
}

async function fetchTicketureEvents(source, registry) {
  const baseUrl = source.ticketureBaseUrl || source.apiUrl || source.url;
  const categories = Array.isArray(source.ticketureCategories) && source.ticketureCategories.length > 0
    ? source.ticketureCategories
    : ["Family", "Events", "Programs"];
  const hiddenTypes = Array.isArray(source.ticketureHiddenTypes) && source.ticketureHiddenTypes.length > 0
    ? source.ticketureHiddenTypes
    : ["public_browsable", "public_member_only"];
  const embeds = [
    "meta",
    "config",
    "venue",
    "ticket_type",
    "ticket_group",
  ];
  const url = new URL(ticketureUrl({ ...source, ticketureBaseUrl: baseUrl }, "/cached_api/events/available"));
  url.searchParams.set("_withmemberevents", "true");
  url.searchParams.set("hidden_type._in", hiddenTypes.join(","));
  url.searchParams.set("ticket_group.hidden_type._in", hiddenTypes.join(","));
  url.searchParams.set("category._in", categories.join(","));
  url.searchParams.set("config.key._in", source.ticketureConfigKeys || "config.image");
  if (source.ticketureMetaKeys) url.searchParams.set("meta.metakey._in", String(source.ticketureMetaKeys));
  url.searchParams.set("_embed", embeds.join(","));

  const payload = await fetchUrlForSource(source, url.toString(), registry.defaults?.userAgent, {
    headers: { accept: "application/json" },
  });
  if (payload.status !== "ok") return payload;

  let json = payload.json;
  if (!json) {
    try {
      json = JSON.parse(payload.text || "{}");
    } catch {
      return { status: "fetch-error", reason: "invalid Ticketure events response" };
    }
  }

  const templates = Array.isArray(json?.event_template?._data) ? json.event_template._data : [];
  const ticketGroups = Array.isArray(json?.ticket_group?._data) ? json.ticket_group._data : [];
  const calendars = {};
  const publicGroupTypes = new Set(hiddenTypes);

  for (const template of templates) {
    const groupIds = ticketGroups
      .filter((group) => group.event_template_id === template.id && publicGroupTypes.has(group.hidden_type))
      .map((group) => group.id);
    if (groupIds.length === 0) continue;

    const calendarUrl = new URL(ticketureUrl({ ...source, ticketureBaseUrl: baseUrl }, `/cached_api/events/${template.id}/calendar`));
    calendarUrl.searchParams.set("ticket_group_id._in", groupIds.join(","));
    calendarUrl.searchParams.set("_format", "extended");
    const calendarPayload = await fetchUrlForSource(source, calendarUrl.toString(), registry.defaults?.userAgent, {
      headers: { accept: "application/json" },
    });
    if (calendarPayload.status !== "ok") continue;
    try {
      calendars[template.id] = calendarPayload.json || JSON.parse(calendarPayload.text || "{}");
    } catch {
      // Keep the event template; the parser can still use dated summary text.
    }
  }

  const out = { ...json, calendars };
  return {
    status: "ok",
    httpStatus: payload.httpStatus,
    contentType: `application/json; source=ticketure-events; events=${templates.length}; calendars=${Object.keys(calendars).length}`,
    json: out,
    text: JSON.stringify(out),
  };
}

async function fetchSanDiegoDrupalCalendar(source, registry) {
  const pagePayload = await fetchUrlForSource(source, source.url, registry.defaults?.userAgent, {
    browserHeaders: source.requiresBrowserHeaders === true,
  });
  if (pagePayload.status !== "ok") return pagePayload;
  const htmlChunks = [`\n<!-- san-diego-page -->\n${pagePayload.text || ""}`];
  const settings = extractDrupalSettings(pagePayload.text || "");
  const ajaxViews = settings?.views?.ajaxViews || {};
  const ajaxView = Object.values(ajaxViews).find((view) =>
    view?.view_name === "events_calendar" && view?.view_display_id === "block_month"
  );
  const libraries = settings?.ajaxPageState?.libraries || "";
  const theme = settings?.ajaxPageState?.theme || "sand";
  if (!ajaxView || !libraries) {
    return {
      status: "ok",
      httpStatus: 200,
      contentType: "text/html; source=san-diego-drupal-page-only",
      text: htmlChunks.join("\n"),
    };
  }

  const ajaxUrl = new URL(settings.views?.ajax_path || "/views/ajax", source.url).toString();
  const months = Number(source.months || 3);
  const now = new Date();
  for (let offset = 0; offset < months; offset += 1) {
    const params = new URLSearchParams({
      _wrapper_format: "drupal_ajax",
      view_name: ajaxView.view_name,
      view_display_id: ajaxView.view_display_id,
      view_args: ajaxView.view_args || "",
      view_path: ajaxView.view_path || new URL(source.url).pathname,
      view_dom_id: ajaxView.view_dom_id || "",
      pager_element: String(ajaxView.pager_element ?? 0),
      calendar_timestamp: String(monthStartSeconds(now, offset)),
      previous: String(monthStartSeconds(now, offset - 1)),
      current: String(Math.floor(Date.now() / 1000)),
      next: String(monthStartSeconds(now, offset + 1)),
      date_format: "custom",
      date_pattern: "F",
      use_previous_next: "0",
      display_reset: "0",
      pager_type: "calendar_month",
      _drupal_ajax: "1",
      "ajax_page_state[theme]": theme,
      "ajax_page_state[theme_token]": "",
      "ajax_page_state[libraries]": libraries,
    });
    const payload = await fetchUrlForSource(source, `${ajaxUrl}?${params.toString()}`, registry.defaults?.userAgent, {
      headers: { accept: "application/json,text/javascript,*/*;q=0.8" },
    });
    if (payload.status !== "ok") continue;
    let commands = [];
    try {
      commands = parseDrupalAjaxCommands(payload);
    } catch {
      commands = [];
    }
    const insertHtml = commands
      .filter((command) => command.command === "insert" && typeof command.data === "string")
      .map((command) => command.data)
      .join("\n");
    if (insertHtml) htmlChunks.push(`\n<!-- san-diego-ajax-month:${offset} -->\n${insertHtml}`);
  }

  return {
    status: "ok",
    httpStatus: 200,
    contentType: "text/html; source=san-diego-drupal-calendar",
    text: htmlChunks.join("\n"),
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
  if (source.sourceType === "civicpluscal" && source.appendNextMonth !== false && !/-curm-\d/.test(source.url)) {
    const next = new Date();
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nm = next.getUTCMonth() + 1;
    const ny = next.getUTCFullYear();
    let nextUrl = `${source.url.replace(/\/$/, "")}/-curm-${nm}/-cury-${ny}`;
    if (/calendar\.aspx/i.test(source.url)) {
      const url = new URL(source.url);
      url.searchParams.set("view", url.searchParams.get("view") || "list");
      url.searchParams.set("month", String(nm));
      url.searchParams.set("year", String(ny));
      if (!url.searchParams.has("CID")) url.searchParams.set("CID", "0");
      nextUrl = url.toString();
    }
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

function extractDrupalSettings(html) {
  const match = html.match(/(?:window\.)?drupalSettings\s*=\s*({[\s\S]*?});/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function monthStartSeconds(now, monthOffset = 0) {
  const date = new Date(now);
  return Math.floor(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + monthOffset, 1, 7, 0, 0) / 1000,
  );
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

function looksBlocked(payload) {
  const text = payload?.text || "";
  return payload?.status === "blocked" ||
    payload?.httpStatus === 403 ||
    /incapsula|imperva|hcaptcha|additional security check|captcha challenge|just a moment|cf-chl|checking your browser|verify you are human|wp engine security/i.test(text);
}

async function fetchUrlForSource(source, url, userAgent, init = {}) {
  const payload = await fetchUrl(url, userAgent, init);
  if (!source.requiresBrowserContext || (payload.status === "ok" && !looksBlocked(payload))) {
    return payload;
  }
  return fetchUrlWithBrowserContext(source, url, init);
}

async function browser() {
  if (!browserInstance) {
    const { chromium } = await import("playwright");
    browserInstance = await chromium.launch({ headless: true });
  }
  return browserInstance;
}

async function closeBrowser() {
  if (!browserInstance) return;
  await browserInstance.close();
  browserInstance = null;
}

async function fetchUrlWithBrowserContext(source, url, init = {}) {
  const launched = await browser();
  const page = await launched.newPage({
    userAgent: BROWSER_HEADERS["user-agent"],
    extraHTTPHeaders: {
      "accept-language": "en-US,en;q=0.9",
    },
  });
  try {
    const warmupUrl = source.browserPageUrl || source.pageUrl || source.homeUrl || source.url || url;
    await page.goto(warmupUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(() => null);
    await page.waitForTimeout(Number(source.browserSettleMs || 750));
    const response = await page.evaluate(async ({ requestUrl, requestInit }) => {
      const response = await fetch(requestUrl, {
        method: requestInit.method || "GET",
        headers: requestInit.headers || {},
        body: requestInit.body || undefined,
        credentials: "include",
      });
      const text = await response.text();
      return {
        ok: response.ok,
        status: response.status,
        contentType: response.headers.get("content-type") || "",
        text,
      };
    }, {
      requestUrl: url,
      requestInit: {
        method: init.method || "GET",
        headers: init.headers || {},
        body: init.body || null,
      },
    });
    let json = null;
    if (/json/i.test(response.contentType)) {
      try {
        json = JSON.parse(response.text);
      } catch {
        json = null;
      }
    }
    return {
      status: response.ok ? "ok" : "http-error",
      httpStatus: response.status,
      contentType: response.contentType,
      text: response.text,
      json,
    };
  } catch (error) {
    return {
      status: "fetch-error",
      reason: `browser fetch failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    await page.close().catch(() => null);
  }
}

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
    if (response.ok && /incapsula|imperva|hcaptcha|additional security check|captcha challenge|just a moment|cf-chl|checking your browser|verify you are human|wp engine security/i.test(text)) {
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

function zonedDateParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    year: Number(value("year")),
    month: Number(value("month")),
    day: Number(value("day")),
    hour: Number(value("hour")),
    minute: Number(value("minute")),
    second: Number(value("second")),
  };
}

function timeZoneOffsetMinutes(date, timeZone) {
  const parts = zonedDateParts(date, timeZone);
  const asUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
  return (asUtc - date.getTime()) / 60000;
}

function startOfZonedDay(date, timeZone) {
  if (!timeZone) {
    return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  }
  const parts = zonedDateParts(date, timeZone);
  const localMidnight = Date.UTC(parts.year, parts.month - 1, parts.day, 0, 0, 0);
  let utcMillis = localMidnight;
  for (let i = 0; i < 3; i += 1) {
    const offset = timeZoneOffsetMinutes(new Date(utcMillis), timeZone);
    utcMillis = localMidnight - offset * 60000;
  }
  return new Date(utcMillis);
}

function filterToPlanningWindow(events, generatedAt, windowDays, timeZone = activeMetro.timezone) {
  const generated = new Date(generatedAt);
  const start = startOfZonedDay(generated, timeZone);
  const end = new Date(start.getTime() + Number(windowDays || 45) * 86400000);
  return events.filter((event) => {
    if (!event.startDateTime) return false;
    const startDate = new Date(event.startDateTime);
    if (!Number.isFinite(startDate.getTime())) return false;
    const endDate = event.endDateTime ? new Date(event.endDateTime) : null;
    const effectiveEnd = endDate && Number.isFinite(endDate.getTime()) ? endDate : startDate;
    return effectiveEnd >= start && startDate <= end;
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

function addFetchedAt(event, generatedAt) {
  if (event.sourceMode === "last-known-good") {
    return {
      ...event,
      fetchedAt: event.fetchedAt || event.originalFetchedAt || generatedAt,
      restoredAt: event.restoredAt || generatedAt,
    };
  }
  return { ...event, fetchedAt: generatedAt };
}

function issueTypeForSource({ report, firstOk, extractedCount, liveCount }) {
  if (report.status === "offline") return "offline";
  if (report.status === "skipped") return "skipped";
  if (!firstOk && report.status !== "ok") return "fetch-failed";
  if (firstOk && extractedCount === 0) return "zero-extracted";
  if (firstOk && extractedCount > 0 && liveCount === 0) return "zero-in-window";
  return null;
}

function logOperatorAlert(alert) {
  const recovery = alert.recoveredBy
    ? `; recovered ${alert.recoveredEvents} via ${alert.recoveredBy}`
    : "; no recovery available";
  console.warn(
    `[event-pipeline-alert] ${alert.severity} ${alert.metroId}/${alert.sourceId}: ${alert.issueType} - ${alert.reason}${recovery}`,
  );
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
  const adultsOutputPath = outputPath.replace(/events\.json$/, "events-adults.json");
  const previousDatasets = [
    await readJsonOrEmpty(outputPath),
    await readJsonOrEmpty(adultsOutputPath),
  ];
  const previousEvents = collectPreviousEvents(previousDatasets);
  const allEvents = [];
  const sourceReports = [];
  const operatorAlerts = [];

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
    let extractedCount = 0;
    let firstOk = null;

    if (!offline && fetchEnabled) {
      const payloads = await fetchSourcePayloads(source, reg);
      report.fetches = payloads.map((payload) => ({
        url: payload.url,
        status: payload.status,
        reason: payload.reason,
        httpStatus: payload.httpStatus,
        contentType: payload.contentType,
      }));
      firstOk = payloads.find((payload) => payload.status === "ok");
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
        extractedCount = extracted.length;
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

    const sourceIssueType = issueTypeForSource({
      report,
      firstOk,
      extractedCount,
      liveCount: liveEvents.length,
    });
    const lastKnownGoodEvents =
      liveEvents.length === 0 && sourceIssueType
        ? lastKnownGoodEventsForSource(previousEvents, source, {
            generatedAt,
            windowDays: reg.defaults?.windowDays || 45,
          })
        : [];
    const templateFallbackEvents =
      liveEvents.length === 0 && lastKnownGoodEvents.length === 0
        ? fallbackTemplates(source, templates, reg, generatedAt)
        : [];
    const recoveredBy =
      lastKnownGoodEvents.length > 0
        ? "last-known-good"
        : templateFallbackEvents.length > 0
          ? "recurring-template"
          : null;

    for (const event of [...liveEvents, ...lastKnownGoodEvents, ...templateFallbackEvents]) {
      allEvents.push({
        ...addFetchedAt(event, generatedAt),
        metroId: event.metroId || activeMetro.id,
        sourceId: event.sourceId || source.id,
        sourceName: event.sourceName || source.name,
        sourceUrl: event.sourceUrl || source.url,
      });
    }
    report.extractedEvents = extractedCount;
    report.liveEvents = liveEvents.length;
    report.lastKnownGoodEvents = lastKnownGoodEvents.length;
    report.fallbackEvents = templateFallbackEvents.length;
    report.recoveryMode = recoveredBy;
    report.eventCount =
      liveEvents.length + lastKnownGoodEvents.length + templateFallbackEvents.length;
    if (report.status === "ok" && liveEvents.length === 0 && lastKnownGoodEvents.length > 0) {
      report.status = "ok-last-known-good";
      report.reason = "source produced no live events; using last-known-good future events";
    } else if (report.status === "ok" && liveEvents.length === 0 && templateFallbackEvents.length > 0) {
      report.status = "ok-template-fallback";
    }
    const alert = buildOperatorAlert({
      source,
      report,
      generatedAt,
      issueType: sourceIssueType,
      recoveredBy,
      recoveredEvents: lastKnownGoodEvents.length + templateFallbackEvents.length,
    });
    if (alert) {
      operatorAlerts.push(alert);
      logOperatorAlert(alert);
    }
    sourceReports.push(report);
    await new Promise((resolve) => setTimeout(resolve, Number(process.env.EVENT_FETCH_DELAY_MS || 100)));
  }
  }

  // Union the city allowlists across registries — adults coverage may extend
  // beyond the kid registry (e.g., late-night neighborhoods or breweries).
  const unionCities = new Set(registry.coverage?.cities || []);
  for (const c of adultRegistry?.coverage?.cities || []) unionCities.add(c);

  const datasetOpts = {
    metroId: activeMetro.id,
    generatedAt,
    registryPath,
    sourceName: `${activeMetro.label} event source registry`,
    coverage: { ...registry.coverage, cities: Array.from(unionCities) },
    sourceCount:
      (registry.sources || []).length + (adultRegistry?.sources || []).length,
  };

  const kidsEvents = allEvents.filter((e) => {
    const a = e.audiences;
    if (!Array.isArray(a) || a.length === 0) return true;
    return a.includes("kids") || a.includes("all");
  });
  const KIDS_EVENT_RE = /\b(story\s*time|storytime|lapsit|lap\s*sit|toddler|preschool|baby|babies|infant|diaper|stroller|family|families|kids?\s*craft|puppet|pajama|pj\b|bedtime|mommy|daddy|parent.child|child|children|kid|kids|daniel\s*tiger|sesame|peppa|zoo|petting|farm|barnyard|playground|splash\s*pad)\b/i;
  const KIDS_CATEGORIES = new Set(["Library", "Zoo", "Farm", "Park"]);
  const adultsEvents = allEvents.filter((e) => {
    const a = e.audiences;
    if (Array.isArray(a) && a.includes("adults")) return true;
    if (!Array.isArray(a) || a.length === 0 || a.includes("all")) {
      if (KIDS_CATEGORIES.has(e.category)) return false;
      if (KIDS_EVENT_RE.test(e.title || "")) return false;
      return true;
    }
    return false;
  });

  const kidsDataset = buildEventsDataset(kidsEvents, datasetOpts);
  const adultsDataset = buildEventsDataset(adultsEvents, datasetOpts);

  const errors = validateEventsDataset(kidsDataset, {
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

  // ADR 02: tag alerts whose sourceId has an unexpired snooze in
  // data/alert-snoozes.json. The UI greys these out; suppression
  // (vs. tagging) is a UI concern.
  const snoozesDoc = readSnoozesFile(ROOT);
  const snoozeMap = activeSnoozeMap(snoozesDoc, new Date(generatedAt));
  const annotatedAlerts = annotateAlertsWithSnoozes(operatorAlerts, snoozeMap);

  const report = {
    schemaVersion: 1,
    metroId: activeMetro.id,
    generatedAt,
    registryPath,
    outputPath,
    eventCount: kidsDataset.events.length,
    adultsEventCount: adultsDataset.events.length,
    sourceCount: sourceReports.length,
    liveEventCount: sourceReports.reduce((sum, item) => sum + item.liveEvents, 0),
    lastKnownGoodEventCount: sourceReports.reduce(
      (sum, item) => sum + (item.lastKnownGoodEvents || 0),
      0,
    ),
    fallbackEventCount: sourceReports.reduce((sum, item) => sum + item.fallbackEvents, 0),
    operatorAlertCount: annotatedAlerts.length,
    errors,
    operatorAlerts: annotatedAlerts,
    sources: sourceReports,
  };
  const alertsDoc = {
    schemaVersion: 1,
    metroId: activeMetro.id,
    generatedAt,
    alertCount: annotatedAlerts.length,
    alerts: annotatedAlerts,
  };

  if (errors.length > 0) {
    await fs.mkdir(path.dirname(reportPath), { recursive: true });
    await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
    await fs.mkdir(path.dirname(alertsPath), { recursive: true });
    await fs.writeFile(alertsPath, `${JSON.stringify(alertsDoc, null, 2)}\n`);
    throw new Error(`Generated events failed validation:\n${errors.join("\n")}`);
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(kidsDataset, null, 2)}\n`);
  await fs.writeFile(adultsOutputPath, `${JSON.stringify(adultsDataset, null, 2)}\n`);
  const legacyOutput = legacyMetroDataFile(activeMetro, "events");
  if (legacyOutput) {
    await fs.mkdir(path.dirname(legacyOutput), { recursive: true });
    await fs.writeFile(legacyOutput, `${JSON.stringify(kidsDataset, null, 2)}\n`);
  }
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  await fs.mkdir(path.dirname(alertsPath), { recursive: true });
  await fs.writeFile(alertsPath, `${JSON.stringify(alertsDoc, null, 2)}\n`);

  // Per ADR-04: roll the 90-day slug history forward so generate-seo-pages.mjs
  // can emit "event has ended" noindex stubs for one-off URLs that just
  // dropped out of events.json.
  const previousHistory = await readJsonOrEmpty(slugHistoryPath);
  const nextHistory = updateSlugHistory(
    previousHistory,
    [kidsDataset, adultsDataset],
    { metroId: activeMetro.id, now: new Date(generatedAt) },
  );
  await fs.mkdir(path.dirname(slugHistoryPath), { recursive: true });
  await fs.writeFile(slugHistoryPath, `${JSON.stringify(nextHistory, null, 2)}\n`);
  const legacyReport = legacyMetroDataFile(activeMetro, "eventReport");
  if (legacyReport) {
    await fs.mkdir(path.dirname(legacyReport), { recursive: true });
    await fs.writeFile(legacyReport, `${JSON.stringify(report, null, 2)}\n`);
    const legacyAlerts = legacyReport.replace(
      /event-build-report\.json$/,
      "event-operator-alerts.json",
    );
    await fs.writeFile(legacyAlerts, `${JSON.stringify(alertsDoc, null, 2)}\n`);
  }
  console.log(
    `Wrote ${kidsDataset.events.length} kids events to ${outputPath}`,
  );
  console.log(
    `Wrote ${adultsDataset.events.length} adults events to ${adultsOutputPath}`,
  );
  console.log(`Wrote event build report to ${reportPath}`);
  console.log(`Wrote ${operatorAlerts.length} operator alerts to ${alertsPath}`);
}

main()
  .then(() => closeBrowser())
  .catch(async (error) => {
    await closeBrowser().catch(() => null);
    console.error(error);
    process.exit(1);
  });
