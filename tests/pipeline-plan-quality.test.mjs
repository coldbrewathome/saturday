import test from "node:test";
import assert from "node:assert/strict";
import {
  MAX_PLAN_RADIUS_MILES,
  auditPlanGeometry,
  coherentPicks,
  eventStartsAtOrAfter,
  expiredFeaturedPlanRefs,
  maxLegMiles,
  milesBetween,
  nearestNeighborOrder,
  totalPathMiles,
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

// E13: 4 stops pairwise <=14mi arranged so the given-order path fails C1.3
// (total path length); a nearest-neighbor reorder of the same stops passes.
const ZIGZAG_A = { id: "a", lat: 37.7, lon: -122.5 };
const ZIGZAG_B = { id: "b", lat: 37.7, lon: -122.3 };
const ZIGZAG_C = { id: "c", lat: 37.7, lon: -122.47 };
const ZIGZAG_D = { id: "d", lat: 37.7, lon: -122.28 };

test("E13: given-order zigzag fails total path; nearest-neighbor reorder passes", () => {
  const given = [ZIGZAG_A, ZIGZAG_B, ZIGZAG_C, ZIGZAG_D];
  // Pairwise stays under the 15mi radius throughout.
  for (let i = 0; i < given.length; i++) {
    for (let j = i + 1; j < given.length; j++) {
      assert.ok(milesBetween(given[i], given[j]) <= 14, `pairwise ${given[i].id}-${given[j].id} exceeds 14mi`);
    }
  }
  assert.ok(totalPathMiles(given) > 25, "given order should exceed the 25mi total-path cap");

  const stopIds = given.map((p) => p.id);
  const byId = new Map(given.map((p) => [p.id, p]));
  const plan = { id: "zigzag-plan", stopIds };
  const errors = auditPlanGeometry(plan, (id) => byId.get(id));
  assert.ok(errors.length > 0, "given order should fail geometry audit");
  assert.match(errors.join(" "), /geo-monotone|total path/);

  const reordered = nearestNeighborOrder(given);
  assert.ok(maxLegMiles(reordered) <= 12, "reordered max leg should be within 12mi");
  assert.ok(totalPathMiles(reordered) <= 25, "reordered total path should be within 25mi");
  const reorderedPlan = { id: "zigzag-plan-fixed", stopIds: reordered.map((p) => p.id) };
  assert.deepEqual(auditPlanGeometry(reorderedPlan, (id) => byId.get(id)), []);
});

// E14: one stop far outside the pairwise radius fails; a tight in-metro
// cluster passes.
const BERKELEY = { id: "berkeley", lat: 37.8716, lon: -122.2727 };
const OAKLAND = { id: "oakland", lat: 37.8044, lon: -122.2712 };
const ALAMEDA = { id: "alameda", lat: 37.7652, lon: -122.2416 };

test("E14: a 40+mi outlier stop fails; Berkeley -> Oakland -> Alameda passes", () => {
  const byId = new Map([BERKELEY, OAKLAND, ALAMEDA, DIXON].map((p) => [p.id, p]));
  const farPlan = { id: "far-plan", stopIds: ["berkeley", "dixon"] };
  const farErrors = auditPlanGeometry(farPlan, (id) => byId.get(id));
  assert.ok(farErrors.length > 0);
  assert.match(farErrors[0], /apart/);

  const nearPlan = { id: "near-plan", stopIds: ["berkeley", "oakland", "alameda"] };
  assert.deepEqual(auditPlanGeometry(nearPlan, (id) => byId.get(id)), []);
});

// E15: an unresolvable stopId is a validation failure, never a silent skip;
// a plan left with fewer than 2 resolvable stops is flagged, not padded.
test("E15: unresolvable stopId fails validation instead of silently passing", () => {
  const byId = new Map([BERKELEY, OAKLAND].map((p) => [p.id, p]));
  const plan = { id: "curated-plan", stopIds: ["berkeley", "missing-stop", "oakland"] };
  const errors = auditPlanGeometry(plan, (id) => byId.get(id));
  assert.ok(errors.some((e) => /unresolvable stop "missing-stop"/.test(e)));

  const tooFew = { id: "too-few", stopIds: ["missing-a", "missing-b"] };
  const tooFewErrors = auditPlanGeometry(tooFew, () => null);
  assert.ok(tooFewErrors.some((e) => /unresolvable stop/.test(e)));
  assert.ok(tooFewErrors.some((e) => /fewer than 2 resolvable stops/.test(e)));
});
