import { test } from "node:test";
import assert from "node:assert/strict";
import {
  missingPageDisposition,
  parseDetailPath,
  slugEndedAfterMs,
} from "../functions/_detail-guard.mjs";

// --- parseDetailPath ---------------------------------------------------------

test("parses metro event and spot detail paths, slash optional", () => {
  assert.deepEqual(
    parseDetailPath("/los-angeles/event/canoga-park-memorial-day-parade-2026-05-25/"),
    { metro: "los-angeles", kind: "event", slug: "canoga-park-memorial-day-parade-2026-05-25" },
  );
  assert.deepEqual(parseDetailPath("/bay-area/spot/exploratorium"), {
    metro: "bay-area",
    kind: "spot",
    slug: "exploratorium",
  });
});

test("ignores non-detail paths", () => {
  assert.equal(parseDetailPath("/bay-area/this-weekend/"), null);
  assert.equal(parseDetailPath("/bay-area/event/"), null);
  assert.equal(parseDetailPath("/bay-area/event/a/b/"), null);
  assert.equal(parseDetailPath("/api/plan"), null);
  assert.equal(parseDetailPath("/"), null);
});

// --- slugEndedAfterMs ----------------------------------------------------------

test("parses the trailing YYYY-MM-DD and adds two days of grace", () => {
  const endedAfter = slugEndedAfterMs("summer-fest-2026-06-05");
  assert.equal(endedAfter, Date.UTC(2026, 5, 5) + 2 * 24 * 60 * 60 * 1000);
});

test("returns null for undated or impossible-date slugs", () => {
  assert.equal(slugEndedAfterMs("storytime-weekly"), null);
  assert.equal(slugEndedAfterMs("fest-2026-13-01"), null);
  assert.equal(slugEndedAfterMs("fest-2026-00-10"), null);
  assert.equal(slugEndedAfterMs(""), null);
});

// --- missingPageDisposition (410 vs noindex shell) ---------------------------

const NOW = Date.UTC(2026, 5, 10, 18); // 2026-06-10T18:00Z

test("past-dated event slug with no prerendered page is gone (410)", () => {
  assert.equal(
    missingPageDisposition("event", "canoga-park-memorial-day-parade-2026-05-25", NOW),
    "gone",
  );
});

test("yesterday's event stays within the grace window", () => {
  assert.equal(missingPageDisposition("event", "concert-2026-06-09", NOW), "noindex-shell");
  // ...but is gone once the grace window has fully elapsed.
  assert.equal(
    missingPageDisposition("event", "concert-2026-06-09", Date.UTC(2026, 5, 11, 0, 1)),
    "gone",
  );
});

test("future and undated event slugs get the noindex shell, not a 410", () => {
  assert.equal(missingPageDisposition("event", "parade-2026-07-04", NOW), "noindex-shell");
  assert.equal(missingPageDisposition("event", "weekly-storytime", NOW), "noindex-shell");
});

test("spot pages never 410, even with a date-like suffix", () => {
  assert.equal(missingPageDisposition("spot", "pop-up-2020-01-01", NOW), "noindex-shell");
  assert.equal(missingPageDisposition("spot", "exploratorium", NOW), "noindex-shell");
});

// --- missingPageDisposition with an authoritative catalog (404 vs 410) --------

const CATALOG = {
  liveSet: new Set(["coyote-hills-fabulous-frogs", "summer-fest-2026-08-01"]),
  endedSet: new Set(["hayward-rec-family-fun-day-9d4b2ef02f"]),
};

test("undated slug in the ended catalog is gone (410), not a soft-404", () => {
  assert.equal(
    missingPageDisposition("event", "hayward-rec-family-fun-day-9d4b2ef02f", NOW, CATALOG),
    "gone",
  );
});

test("live-but-capped event (in liveSet, no page) stays noindex-shell, never 404", () => {
  assert.equal(
    missingPageDisposition("event", "coyote-hills-fabulous-frogs", NOW, CATALOG),
    "noindex-shell",
  );
  // A future-dated live event the catalog knows about is also just shell.
  assert.equal(
    missingPageDisposition("event", "summer-fest-2026-08-01", NOW, CATALOG),
    "noindex-shell",
  );
});

test("slug the catalog never recorded is a real 404", () => {
  assert.equal(
    missingPageDisposition("event", "this-is-a-totally-fake-event-xyz123", NOW, CATALOG),
    "not-found",
  );
});

test("a past date always wins over the catalog (410 even if untracked)", () => {
  assert.equal(
    missingPageDisposition("event", "mystery-parade-2026-05-25", NOW, CATALOG),
    "gone",
  );
});

test("without a catalog, unknown event slugs stay noindex-shell (no false 404)", () => {
  assert.equal(missingPageDisposition("event", "who-knows-this", NOW), "noindex-shell");
  assert.equal(missingPageDisposition("event", "who-knows-this", NOW, null), "noindex-shell");
});

test("spots ignore the catalog entirely", () => {
  assert.equal(
    missingPageDisposition("spot", "this-is-a-totally-fake-spot-xyz123", NOW, CATALOG),
    "noindex-shell",
  );
});
