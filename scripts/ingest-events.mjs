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

const registryPath = process.env.EVENT_SOURCES || path.join("data", "event-sources.json");
const templatePath = process.env.EVENT_TEMPLATE_INPUT || path.join("data", "event-templates.json");
const manualEventsPath =
  process.env.EVENT_MANUAL_INPUT || path.join("data", "manual-events.json");
const outputPath = process.env.EVENT_OUTPUT || path.join("public", "data", "events.json");
const reportPath =
  process.env.EVENT_REPORT_OUTPUT || path.join("public", "data", "event-build-report.json");
const minEvents = Number(process.env.MIN_EVENTS || 25);
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
    url.searchParams.set("city", source.city || "San Francisco");
    url.searchParams.set("startDateTime", now.toISOString().replace(/\.\d{3}Z$/, "Z"));
    url.searchParams.set("endDateTime", end.toISOString().replace(/\.\d{3}Z$/, "Z"));
    url.searchParams.set("size", "100");
    return fetchUrl(url.toString(), registry.defaults?.userAgent);
  }
  return fetchUrl(source.url, registry.defaults?.userAgent);
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

  const urls = Array.isArray(source.urls) && source.urls.length > 0 ? source.urls : [source.url];
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

async function fetchUrl(url, userAgent, init = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,application/rss+xml,application/xml,text/calendar;q=0.9,*/*;q=0.8",
        "user-agent": userAgent || "saturday-with-friends/0.1 event-ingest",
        ...(init.headers || {}),
      },
    });
    const contentType = response.headers.get("content-type") || "";
    const text = await response.text();
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
  try {
    return await readJson(filePath);
  } catch (err) {
    if (err && err.code === "ENOENT") return null;
    throw err;
  }
}

async function main() {
  const registry = await readJson(registryPath);
  const templateDataset = await readJson(templatePath);
  const templates = templateMap(templateDataset);
  const manualDataset = await readJsonOrEmpty(manualEventsPath);
  const generatedAt = new Date().toISOString();
  const allEvents = [];
  const sourceReports = [];

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
      category: null,
      status: "ok",
      liveEvents: manualCount,
      fallbackEvents: 0,
      eventCount: manualCount,
      fetches: [],
    });
  }

  for (const source of registry.sources || []) {
    if (source.enabled === false && source.sourceType !== "ticketmaster") {
      sourceReports.push({
        id: source.id,
        name: source.name,
        url: source.url,
        sourceType: source.sourceType || "html",
        city: source.city,
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
      category: source.category,
      status: "pending",
      liveEvents: 0,
      fallbackEvents: 0,
      eventCount: 0,
      fetches: [],
    };
    if (source.disabledReason || source.notes) {
      report.reason = source.disabledReason || source.notes;
    }
    let liveEvents = [];

    if (!offline && source.enabled !== false) {
      const payloads = await fetchSourcePayloads(source, registry);
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
              windowDays: registry.defaults?.windowDays || 45,
            },
          ));
        liveEvents = dedupeEvents(filterToPlanningWindow(
          extracted,
          generatedAt,
          registry.defaults?.windowDays || 45,
        ));
        report.rejectedLiveEvents = extracted.length - liveEvents.length;
      }
    } else {
      report.status = source.enabled === false ? "disabled" : "offline";
    }

    const fallbackEvents =
      liveEvents.length > 0 ? [] : fallbackTemplates(source, templates, registry, generatedAt);
    for (const event of [...liveEvents, ...fallbackEvents]) {
      allEvents.push({
        ...event,
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

  const dataset = buildEventsDataset(allEvents, {
    generatedAt,
    registryPath,
    coverage: registry.coverage,
    sourceCount: (registry.sources || []).length,
  });
  const errors = validateEventsDataset(dataset, {
    minEvents,
    cities: registry.coverage?.cities || [],
    communities: ["Muir Beach", "Bay Area"],
  });

  const report = {
    schemaVersion: 1,
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
  await fs.mkdir(path.dirname(reportPath), { recursive: true });
  await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `Wrote ${dataset.events.length} events to ${outputPath} (${report.liveEventCount} live, ${report.fallbackEventCount} template).`,
  );
  console.log(`Wrote event build report to ${reportPath}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
