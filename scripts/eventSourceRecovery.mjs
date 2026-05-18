import { dedupeEvents } from "./eventPipeline.mjs";

function eventTime(event) {
  const time = new Date(event?.startDateTime || "").getTime();
  return Number.isFinite(time) ? time : null;
}

export function filterEventsToWindow(events, generatedAt, windowDays = 45) {
  const generated = new Date(generatedAt);
  const start = new Date(Date.UTC(
    generated.getUTCFullYear(),
    generated.getUTCMonth(),
    generated.getUTCDate(),
  ));
  const end = new Date(start.getTime() + Number(windowDays || 45) * 86400000);
  return (events || []).filter((event) => {
    const time = eventTime(event);
    return time !== null && time >= start.getTime() && time <= end.getTime();
  });
}

function isRecoverablePreviousEvent(event) {
  if (!event || !event.sourceId) return false;
  if (event.sourceMode === "recurring-template") return false;
  if (event.extractionMethod === "recurring-template") return false;
  return true;
}

export function collectPreviousEvents(datasets = []) {
  return datasets.flatMap((dataset) => {
    const events = Array.isArray(dataset?.events) ? dataset.events : [];
    return events.filter(isRecoverablePreviousEvent);
  });
}

export function lastKnownGoodEventsForSource(previousEvents, source, options = {}) {
  const generatedAt = options.generatedAt || new Date().toISOString();
  const windowDays = options.windowDays || 45;
  const sourceId = source?.id;
  if (!sourceId) return [];

  const inWindow = filterEventsToWindow(
    previousEvents.filter((event) => event.sourceId === sourceId),
    generatedAt,
    windowDays,
  );

  return dedupeEvents(inWindow).map((event) => {
    const originalSourceMode =
      event.sourceMode === "last-known-good"
        ? event.originalSourceMode || event.extractionMethod || null
        : event.sourceMode || event.extractionMethod || null;
    return {
      ...event,
      sourceMode: "last-known-good",
      originalSourceMode,
      originalFetchedAt: event.originalFetchedAt || event.fetchedAt || null,
      restoredAt: generatedAt,
    };
  });
}

export function buildOperatorAlert({
  source,
  report,
  generatedAt,
  issueType,
  recoveredBy = null,
  recoveredEvents = 0,
}) {
  if (!issueType) return null;
  const hasRecovery = Boolean(recoveredBy && recoveredEvents > 0);
  return {
    severity: alertSeverity(issueType, hasRecovery),
    metroId: report.metroId,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.sourceType || "html",
    url: source.url,
    status: report.status,
    issueType,
    reason: report.reason || defaultReason(issueType),
    recoveredBy,
    recoveredEvents,
    liveEvents: report.liveEvents,
    fallbackEvents: report.fallbackEvents,
    lastKnownGoodEvents: report.lastKnownGoodEvents,
    fetchedAt: generatedAt,
    fetches: report.fetches || [],
  };
}

function alertSeverity(issueType, hasRecovery) {
  if (hasRecovery) return "warning";
  if (issueType === "zero-in-window") return "warning";
  return "critical";
}

function defaultReason(issueType) {
  if (issueType === "fetch-failed") return "Source fetch did not return a usable payload.";
  if (issueType === "offline") return "Event ingest ran in offline mode.";
  if (issueType === "zero-extracted") return "Source returned a payload but no events were extracted.";
  if (issueType === "zero-in-window") return "Source returned events, but none were in the planning window.";
  if (issueType === "skipped") return "Source was skipped by the fetcher.";
  return "Source needs operator attention.";
}
