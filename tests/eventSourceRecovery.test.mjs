import test from "node:test";
import assert from "node:assert/strict";
import { dedupeEvents } from "../scripts/eventPipeline.mjs";
import {
  buildOperatorAlert,
  collectPreviousEvents,
  lastKnownGoodEventsForSource,
} from "../scripts/eventSourceRecovery.mjs";

const generatedAt = "2026-05-17T12:00:00.000Z";
const source = {
  id: "sfpl",
  name: "San Francisco Public Library",
  sourceType: "biblioevents",
  url: "https://sfpl.org/events",
};

test("lastKnownGoodEventsForSource restores future source events and excludes templates", () => {
  const previousEvents = collectPreviousEvents([
    {
      events: [
        {
          id: "future-storytime",
          title: "Family Storytime",
          venue: "Main Library",
          city: "San Francisco",
          startDateTime: "2026-05-20T17:00:00.000Z",
          sourceId: "sfpl",
          sourceName: "San Francisco Public Library",
          sourceMode: "biblioevents",
          extractionMethod: "biblioevents",
          verified: true,
          fetchedAt: "2026-05-16T12:00:00.000Z",
        },
        {
          id: "old-storytime",
          title: "Old Storytime",
          venue: "Main Library",
          city: "San Francisco",
          startDateTime: "2026-04-01T17:00:00.000Z",
          sourceId: "sfpl",
          sourceMode: "biblioevents",
          extractionMethod: "biblioevents",
        },
        {
          id: "template-storytime",
          title: "Template Storytime",
          venue: "Main Library",
          city: "San Francisco",
          startDateTime: "2026-05-21T17:00:00.000Z",
          sourceId: "sfpl",
          sourceMode: "recurring-template",
          extractionMethod: "recurring-template",
        },
      ],
    },
    {
      events: [
        {
          id: "future-storytime-adult-copy",
          title: "Family Storytime",
          venue: "Main Library",
          city: "San Francisco",
          startDateTime: "2026-05-20T17:00:00.000Z",
          sourceId: "sfpl",
          sourceMode: "biblioevents",
          extractionMethod: "biblioevents",
        },
        {
          id: "other-source",
          title: "Other Source Event",
          venue: "Main Library",
          city: "San Francisco",
          startDateTime: "2026-05-22T17:00:00.000Z",
          sourceId: "other",
          sourceMode: "live",
          extractionMethod: "json-ld",
        },
      ],
    },
  ]);

  const restored = lastKnownGoodEventsForSource(previousEvents, source, {
    generatedAt,
    windowDays: 45,
  });

  assert.equal(restored.length, 1);
  assert.equal(restored[0].title, "Family Storytime");
  assert.equal(restored[0].sourceMode, "last-known-good");
  assert.equal(restored[0].originalSourceMode, "biblioevents");
  assert.equal(restored[0].originalFetchedAt, "2026-05-16T12:00:00.000Z");
  assert.equal(restored[0].restoredAt, generatedAt);
});

test("dedupeEvents prefers a current live event over a last-known-good duplicate", () => {
  const startDateTime = "2026-05-20T17:00:00.000Z";
  const deduped = dedupeEvents([
    {
      title: "Family Storytime",
      venue: "Main Library",
      startDateTime,
      sourceMode: "last-known-good",
      extractionMethod: "biblioevents",
      verified: true,
    },
    {
      title: "Family Storytime",
      venue: "Main Library",
      startDateTime,
      sourceMode: "biblioevents",
      extractionMethod: "biblioevents",
      verified: true,
    },
  ]);

  assert.equal(deduped.length, 1);
  assert.equal(deduped[0].sourceMode, "biblioevents");
});

test("buildOperatorAlert escalates source failures with recovery context", () => {
  const alert = buildOperatorAlert({
    source,
    generatedAt,
    issueType: "fetch-failed",
    recoveredBy: "last-known-good",
    recoveredEvents: 2,
    report: {
      metroId: "bay-area",
      status: "fetch-error",
      reason: "HTTP 503",
      liveEvents: 0,
      fallbackEvents: 0,
      lastKnownGoodEvents: 2,
      fetches: [{ url: source.url, status: "fetch-error", httpStatus: 503 }],
    },
  });

  assert.equal(alert.severity, "warning");
  assert.equal(alert.sourceId, "sfpl");
  assert.equal(alert.recoveredBy, "last-known-good");
  assert.equal(alert.recoveredEvents, 2);
  assert.equal(alert.reason, "HTTP 503");

  const critical = buildOperatorAlert({
    source,
    generatedAt,
    issueType: "zero-extracted",
    recoveredEvents: 0,
    report: {
      metroId: "bay-area",
      status: "ok",
      liveEvents: 0,
      fallbackEvents: 0,
      lastKnownGoodEvents: 0,
      fetches: [],
    },
  });

  assert.equal(critical.severity, "critical");
  assert.equal(critical.reason, "Source returned a payload but no events were extracted.");

  const seasonal = buildOperatorAlert({
    source,
    generatedAt,
    issueType: "zero-in-window",
    recoveredEvents: 0,
    report: {
      metroId: "bay-area",
      status: "ok",
      liveEvents: 0,
      fallbackEvents: 0,
      lastKnownGoodEvents: 0,
      fetches: [],
    },
  });

  assert.equal(seasonal.severity, "warning");
});
