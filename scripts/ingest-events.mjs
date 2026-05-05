#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import {
  buildEventsDataset,
  expandRecurringTemplates,
  extractEventsFromPayload,
  validateEventsDataset,
} from "./eventPipeline.mjs";

const registryPath = process.env.EVENT_SOURCES || path.join("data", "event-sources.json");
const templatePath = process.env.EVENT_TEMPLATE_INPUT || path.join("data", "event-templates.json");
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

function extractQueryParam(url, key) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get(key);
  } catch {
    return null;
  }
}

async function fetchUrl(url, userAgent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "text/html,application/xhtml+xml,application/json,application/rss+xml,application/xml,text/calendar;q=0.9,*/*;q=0.8",
        "user-agent": userAgent || "saturday-with-friends/0.1 event-ingest",
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

async function main() {
  const registry = await readJson(registryPath);
  const templateDataset = await readJson(templatePath);
  const templates = templateMap(templateDataset);
  const generatedAt = new Date().toISOString();
  const allEvents = [];
  const sourceReports = [];

  for (const source of registry.sources || []) {
    if (source.enabled === false && source.sourceType !== "ticketmaster") {
      sourceReports.push({ id: source.id, name: source.name, status: "disabled" });
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
    };
    let liveEvents = [];

    if (!offline && source.enabled !== false) {
      const payload = await fetchSource(source, registry);
      report.status = payload.status;
      if (payload.reason) report.reason = payload.reason;
      if (payload.httpStatus) report.httpStatus = payload.httpStatus;
      if (payload.contentType) report.contentType = payload.contentType;
      if (payload.status === "ok") {
        const extracted = extractEventsFromPayload(payload, source, { now: new Date(generatedAt) });
        liveEvents = filterToPlanningWindow(
          extracted,
          generatedAt,
          registry.defaults?.windowDays || 45,
        );
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
