import test from "node:test";
import assert from "node:assert/strict";
import {
  activeSnoozeMap,
  annotateAlertsWithSnoozes,
  parseSnoozesDoc,
  upsertSnooze,
  SNOOZES_SCHEMA_VERSION,
} from "../scripts/alertSnoozes.mjs";

test("parseSnoozesDoc returns an empty doc for missing/empty input", () => {
  for (const raw of [null, undefined, ""]) {
    const doc = parseSnoozesDoc(raw);
    assert.equal(doc.schemaVersion, SNOOZES_SCHEMA_VERSION);
    assert.deepEqual(doc.snoozes, []);
  }
});

test("parseSnoozesDoc accepts strings or pre-parsed objects", () => {
  const json = JSON.stringify({
    schemaVersion: 1,
    snoozes: [{ sourceId: "a", until: "2026-06-01T00:00:00Z" }],
  });
  const fromString = parseSnoozesDoc(json);
  const fromObject = parseSnoozesDoc({
    schemaVersion: 1,
    snoozes: [{ sourceId: "a", until: "2026-06-01T00:00:00Z" }],
  });
  assert.deepEqual(fromString, fromObject);
  assert.equal(fromString.snoozes.length, 1);
});

test("parseSnoozesDoc drops malformed entries instead of crashing", () => {
  const doc = parseSnoozesDoc({
    schemaVersion: 1,
    snoozes: [
      { sourceId: "ok", until: "2026-06-01T00:00:00Z" },
      // missing until
      { sourceId: "no-until" },
      // missing sourceId
      { until: "2026-06-01T00:00:00Z" },
      // garbage timestamp
      { sourceId: "bad-date", until: "not-a-date" },
      // non-object
      null,
      "junk",
    ],
  });
  assert.deepEqual(
    doc.snoozes.map((s) => s.sourceId),
    ["ok"],
  );
});

test("parseSnoozesDoc falls back when `snoozes` is missing or not an array", () => {
  assert.deepEqual(parseSnoozesDoc({}).snoozes, []);
  assert.deepEqual(parseSnoozesDoc({ snoozes: "nope" }).snoozes, []);
});

test("parseSnoozesDoc throws on syntactically invalid JSON strings", () => {
  assert.throws(() => parseSnoozesDoc("{not json"));
});

test("parseSnoozesDoc preserves optional note and trims sourceId/until", () => {
  const doc = parseSnoozesDoc({
    schemaVersion: 1,
    snoozes: [
      {
        sourceId: "  whitespace  ",
        until: "  2026-06-01T00:00:00Z  ",
        note: "investigate parser",
      },
      { sourceId: "no-note", until: "2026-06-01T00:00:00Z" },
    ],
  });
  assert.equal(doc.snoozes[0].sourceId, "whitespace");
  assert.equal(doc.snoozes[0].until, "2026-06-01T00:00:00Z");
  assert.equal(doc.snoozes[0].note, "investigate parser");
  assert.equal(doc.snoozes[1].note, undefined);
});

test("activeSnoozeMap drops entries at or before `now` (expiry boundary)", () => {
  const now = new Date("2026-05-25T12:00:00Z");
  const doc = {
    schemaVersion: 1,
    snoozes: [
      // strictly in the past
      { sourceId: "past", until: "2026-05-24T00:00:00Z" },
      // exactly at now (boundary — expired)
      { sourceId: "boundary", until: "2026-05-25T12:00:00Z" },
      // in the future
      { sourceId: "future", until: "2026-05-26T00:00:00Z" },
    ],
  };
  const map = activeSnoozeMap(doc, now);
  assert.equal(map.has("past"), false);
  assert.equal(map.has("boundary"), false);
  assert.equal(map.get("future"), "2026-05-26T00:00:00Z");
});

test("activeSnoozeMap picks the latest `until` when sourceId repeats", () => {
  const now = new Date("2026-05-25T00:00:00Z");
  const map = activeSnoozeMap(
    {
      schemaVersion: 1,
      snoozes: [
        { sourceId: "dup", until: "2026-05-26T00:00:00Z" },
        { sourceId: "dup", until: "2026-05-30T00:00:00Z" },
        { sourceId: "dup", until: "2026-05-27T00:00:00Z" },
      ],
    },
    now,
  );
  assert.equal(map.get("dup"), "2026-05-30T00:00:00Z");
});

test("activeSnoozeMap returns empty for missing/empty docs", () => {
  assert.equal(activeSnoozeMap(null, new Date()).size, 0);
  assert.equal(activeSnoozeMap(undefined, new Date()).size, 0);
  assert.equal(activeSnoozeMap({}, new Date()).size, 0);
  assert.equal(activeSnoozeMap({ snoozes: [] }, new Date()).size, 0);
});

test("annotateAlertsWithSnoozes tags matching alerts and leaves others untouched", () => {
  const alerts = [
    { sourceId: "snoozed", severity: "critical" },
    { sourceId: "loud", severity: "critical" },
  ];
  const map = new Map([["snoozed", "2026-06-01T00:00:00Z"]]);
  const annotated = annotateAlertsWithSnoozes(alerts, map);
  assert.equal(annotated[0].snoozedUntil, "2026-06-01T00:00:00Z");
  assert.equal(annotated[1].snoozedUntil, undefined);
});

test("annotateAlertsWithSnoozes does not mutate the input alerts", () => {
  const alerts = [{ sourceId: "snoozed", severity: "critical" }];
  const map = new Map([["snoozed", "2026-06-01T00:00:00Z"]]);
  const annotated = annotateAlertsWithSnoozes(alerts, map);
  assert.equal(alerts[0].snoozedUntil, undefined);
  assert.notEqual(annotated[0], alerts[0]);
});

test("annotateAlertsWithSnoozes is a no-op for empty/missing maps", () => {
  const alerts = [{ sourceId: "a", severity: "critical" }];
  assert.equal(annotateAlertsWithSnoozes(alerts, null), alerts);
  assert.equal(annotateAlertsWithSnoozes(alerts, undefined), alerts);
  assert.equal(annotateAlertsWithSnoozes(alerts, new Map()), alerts);
});

test("upsertSnooze adds a new entry and sorts the result", () => {
  const now = new Date("2026-05-25T00:00:00Z");
  const doc = {
    schemaVersion: 1,
    snoozes: [{ sourceId: "zoo", until: "2026-06-01T00:00:00Z" }],
  };
  const next = upsertSnooze(
    doc,
    { sourceId: "aviary", until: "2026-06-02T00:00:00Z" },
    now,
  );
  assert.deepEqual(
    next.snoozes.map((s) => s.sourceId),
    ["aviary", "zoo"],
  );
  assert.equal(next.schemaVersion, SNOOZES_SCHEMA_VERSION);
});

test("upsertSnooze replaces an existing entry for the same sourceId (idempotent)", () => {
  const now = new Date("2026-05-25T00:00:00Z");
  const doc = {
    schemaVersion: 1,
    snoozes: [
      { sourceId: "zoo", until: "2026-06-01T00:00:00Z", note: "old" },
    ],
  };
  const once = upsertSnooze(
    doc,
    { sourceId: "zoo", until: "2026-06-10T00:00:00Z", note: "extended" },
    now,
  );
  const twice = upsertSnooze(
    once,
    { sourceId: "zoo", until: "2026-06-10T00:00:00Z", note: "extended" },
    now,
  );
  assert.equal(once.snoozes.length, 1);
  assert.deepEqual(once.snoozes[0], {
    sourceId: "zoo",
    until: "2026-06-10T00:00:00Z",
    note: "extended",
  });
  assert.deepEqual(twice, once);
});

test("upsertSnooze prunes expired entries opportunistically", () => {
  const now = new Date("2026-05-25T00:00:00Z");
  const doc = {
    schemaVersion: 1,
    snoozes: [
      { sourceId: "old", until: "2026-05-20T00:00:00Z" },
      { sourceId: "fresh", until: "2026-06-01T00:00:00Z" },
    ],
  };
  const next = upsertSnooze(
    doc,
    { sourceId: "new", until: "2026-06-02T00:00:00Z" },
    now,
  );
  assert.deepEqual(
    next.snoozes.map((s) => s.sourceId).sort(),
    ["fresh", "new"],
  );
});

test("upsertSnooze throws on invalid input", () => {
  const doc = { schemaVersion: 1, snoozes: [] };
  assert.throws(() => upsertSnooze(doc, { sourceId: "", until: "2026-06-01T00:00:00Z" }));
  assert.throws(() => upsertSnooze(doc, { sourceId: "x", until: "" }));
  assert.throws(() => upsertSnooze(doc, { sourceId: "x", until: "not-a-date" }));
});

test("upsertSnooze tolerates a malformed input doc by starting fresh", () => {
  const next = upsertSnooze(
    null,
    { sourceId: "x", until: "2026-06-01T00:00:00Z" },
    new Date("2026-05-25T00:00:00Z"),
  );
  assert.equal(next.snoozes.length, 1);
  assert.equal(next.snoozes[0].sourceId, "x");
});
