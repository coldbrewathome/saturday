import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PLAN_RADIUS_MILES,
  coherentPicks,
  eventStartsAtOrAfter,
  expiredFeaturedPlanRefs,
  milesBetween,
} from "../scripts/lib/planQuality.mjs";

const DIXON = { id: "dixon", lat: 38.4455, lon: -121.8233 };
const APTOS = { id: "aptos", lat: 36.9772, lon: -121.8994 };
const VACAVILLE = { id: "vacaville", lat: 38.3566, lon: -121.9877 };

test("milesBetween measures the audit chain at ~100mi legs", () => {
  assert.ok(milesBetween(DIXON, APTOS) > 100);
  assert.ok(milesBetween(DIXON, VACAVILLE) < MAX_PLAN_RADIUS_MILES);
});

test("coherentPicks rejects the Dixon -> Aptos -> Vacaville 150mi chain", () => {
  const picks = coherentPicks([DIXON, APTOS, VACAVILLE]);
  assert.deepEqual(picks.map((p) => p.id), ["dixon", "vacaville"]);
});

test("coherentPicks honors the limit and skips items without coordinates", () => {
  const near = { id: "near", lat: 38.45, lon: -121.83 };
  const noCoords = { id: "no-coords" };
  assert.deepEqual(
    coherentPicks([DIXON, noCoords, near, VACAVILLE], 2).map((p) => p.id),
    ["dixon", "near"],
  );
  assert.deepEqual(coherentPicks([noCoords]), []);
});

const NOW = Date.parse("2026-06-09T12:00:00-07:00");

test("eventStartsAtOrAfter only accepts events starting at or after now", () => {
  assert.equal(eventStartsAtOrAfter({ startDateTime: "2026-06-09T13:00:00-07:00" }, NOW), true);
  assert.equal(eventStartsAtOrAfter({ startDateTime: "2026-06-09T12:00:00-07:00" }, NOW), true);
  // A -6h grace window served day-old events as "upcoming"; gone now.
  assert.equal(eventStartsAtOrAfter({ startDateTime: "2026-06-09T08:00:00-07:00" }, NOW), false);
  assert.equal(eventStartsAtOrAfter({ startDateTime: "2026-06-07T10:00:00-07:00" }, NOW), false);
  assert.equal(eventStartsAtOrAfter({}, NOW), false);
});

test("expiredFeaturedPlanRefs flags plans referencing ended events", () => {
  const eventsById = new Map([
    [
      "ended",
      {
        id: "ended",
        title: "BubbleFest",
        startDateTime: "2026-06-07T10:00:00-07:00",
        endDateTime: "2026-06-07T16:30:00-07:00",
      },
    ],
    ["upcoming", { id: "upcoming", title: "Night Market", startDateTime: "2026-06-12T17:00:00-07:00" }],
  ]);
  const plans = [
    { id: "stale-plan", eventIds: ["ended", "upcoming"] },
    { id: "fresh-plan", eventIds: ["upcoming"] },
    { id: "unknown-ref", eventIds: ["not-in-feed"] },
    { id: "no-events", stopIds: ["spot-1"] },
  ];
  const errors = expiredFeaturedPlanRefs(plans, eventsById, NOW);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /stale-plan/);
  assert.match(errors[0], /ended/);
});
