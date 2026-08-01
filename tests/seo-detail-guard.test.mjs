import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ENDED_GRACE_MS,
  isRemovedSectionKind,
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
  // The bare this-weekend HUB (no child) always has a prerendered page and
  // must stay a plain passthrough — only children match (fresh-1).
  assert.equal(parseDetailPath("/bay-area/this-weekend/"), null);
  assert.equal(parseDetailPath("/bay-area/event/"), null);
  assert.equal(parseDetailPath("/bay-area/event/a/b/"), null);
  assert.equal(parseDetailPath("/api/plan"), null);
  assert.equal(parseDetailPath("/"), null);
});

// --- fresh-1: removed section paths (city/category/this-weekend children) ---

test("parses city, category, city-category, and this-weekend child paths", () => {
  assert.deepEqual(parseDetailPath("/seattle/city/enumclaw/"), {
    metro: "seattle",
    kind: "city",
    slug: "enumclaw",
  });
  assert.deepEqual(parseDetailPath("/bay-area/category/library"), {
    metro: "bay-area",
    kind: "category",
    slug: "library",
  });
  assert.deepEqual(parseDetailPath("/los-angeles/city/pasadena/category/festival/"), {
    metro: "los-angeles",
    kind: "city-category",
    slug: "pasadena/festival",
  });
  assert.deepEqual(parseDetailPath("/bay-area/this-weekend/morgan-hill/"), {
    metro: "bay-area",
    kind: "weekend-child",
    slug: "morgan-hill",
  });
});

test("isRemovedSectionKind covers exactly the fresh-1 classes", () => {
  for (const kind of ["city", "category", "city-category", "weekend-child"]) {
    assert.equal(isRemovedSectionKind(kind), true, kind);
  }
  assert.equal(isRemovedSectionKind("event"), false);
  assert.equal(isRemovedSectionKind("spot"), false);
});

test("section kinds never 410 through missingPageDisposition", () => {
  assert.equal(missingPageDisposition("city", "enumclaw", Date.UTC(2026, 6, 1)), "noindex-shell");
  assert.equal(
    missingPageDisposition("weekend-child", "morgan-hill", Date.UTC(2026, 6, 1)),
    "noindex-shell",
  );
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
  // Slug date May 25 → ended after May 27; the 14-day post-end grace ran out
  // at Jun 10 00:00Z, so by NOW (Jun 10 18:00Z) the 410 has landed.
  assert.equal(
    missingPageDisposition("event", "canoga-park-memorial-day-parade-2026-05-25", NOW),
    "gone",
  );
});

test("yesterday's event stays within the start-day grace window", () => {
  assert.equal(missingPageDisposition("event", "concert-2026-06-09", NOW), "noindex-shell");
  // Once the start-day window elapses, the event enters the 14-day post-end
  // grace ("ended-grace": real 200 page, kept in the sitemap)...
  const endedAfter = Date.UTC(2026, 5, 11);
  assert.equal(
    missingPageDisposition("event", "concert-2026-06-09", Date.UTC(2026, 5, 11, 0, 1)),
    "ended-grace",
  );
  // ...and is gone only when the post-end grace has fully elapsed.
  assert.equal(
    missingPageDisposition("event", "concert-2026-06-09", endedAfter + ENDED_GRACE_MS - 1),
    "ended-grace",
  );
  assert.equal(
    missingPageDisposition("event", "concert-2026-06-09", endedAfter + ENDED_GRACE_MS),
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

// --- liveEnds: per-slug end instant beats the slug-date+2d heuristic --------
// (finding 20) A slug is named for the event's *start* date. Without an
// authoritative end instant, a live multi-day exhibition would 410 two days
// into a 60-day run. liveEnds carries the true end (spanning the full
// occurrence run for a deduped multi-date event) and must win.

test("a live multi-day event with a future liveEnds stays noindex-shell, not gone", () => {
  const catalog = {
    liveSet: new Set(["summer-exhibition-2026-07-01"]),
    liveEnds: { "summer-exhibition-2026-07-01": Date.UTC(2026, 7, 30) }, // ends Aug 30
    endedSet: new Set(),
  };
  // Slug's own start-date+2d heuristic would already say "gone" by NOW
  // (2026-06-10) — no, NOW is before the start here; use a later "now".
  const laterNow = Date.UTC(2026, 6, 5); // Jul 5 — well past start+2d, mid-run
  assert.equal(
    missingPageDisposition("event", "summer-exhibition-2026-07-01", laterNow, catalog),
    "noindex-shell",
  );
});

test("a live multi-day event enters ended-grace at its liveEnds instant, gone after 14 days", () => {
  const end = Date.UTC(2026, 7, 30); // ends Aug 30
  const catalog = {
    liveSet: new Set(["summer-exhibition-2026-07-01"]),
    liveEnds: { "summer-exhibition-2026-07-01": end },
    endedSet: new Set(),
  };
  assert.equal(
    missingPageDisposition("event", "summer-exhibition-2026-07-01", Date.UTC(2026, 8, 1), catalog),
    "ended-grace",
  );
  assert.equal(
    missingPageDisposition("event", "summer-exhibition-2026-07-01", end + ENDED_GRACE_MS, catalog),
    "gone",
  );
});

test("liveEnds is honored even for a slug catalog also lists as live (liveEnds wins over liveSet)", () => {
  const end = Date.UTC(2026, 5, 1, 12);
  const catalog = {
    liveSet: new Set(["one-off-2026-06-01"]),
    liveEnds: { "one-off-2026-06-01": end },
    endedSet: new Set(),
  };
  assert.equal(
    missingPageDisposition("event", "one-off-2026-06-01", Date.UTC(2026, 5, 1, 13), catalog),
    "ended-grace",
  );
  assert.equal(
    missingPageDisposition("event", "one-off-2026-06-01", end + ENDED_GRACE_MS, catalog),
    "gone",
  );
});

// --- 14-day post-end grace window (famhop-3) --------------------------------
// Pre-grace, pages 410'd at the exact end instant — right as they ranked.
// "ended-grace" keeps the URL serving 200 (and listed in the sitemap filter)
// through end+14d; the eventual 410 stays.

test("a dated slug in the ended catalog gets grace while its date is recent", () => {
  const catalog = {
    liveSet: new Set(),
    liveEnds: {},
    endedSet: new Set(["parade-2026-06-05"]),
  };
  const endedAfter = slugEndedAfterMs("parade-2026-06-05");
  // Jun 10: inside slug-date + 2d + 14d grace → ended-grace, not gone.
  assert.equal(
    missingPageDisposition("event", "parade-2026-06-05", NOW, catalog),
    "ended-grace",
  );
  assert.equal(
    missingPageDisposition("event", "parade-2026-06-05", endedAfter + ENDED_GRACE_MS, catalog),
    "gone",
  );
});

test("a future-dated slug that vanished from the feed (cancelled) is gone immediately, no grace", () => {
  const catalog = {
    liveSet: new Set(),
    liveEnds: {},
    endedSet: new Set(["festival-2026-07-04"]),
  };
  assert.equal(
    missingPageDisposition("event", "festival-2026-07-04", NOW, catalog),
    "gone",
  );
});

// --- evergreen-rescue exemption (dead-3) -------------------------------------
// Curated ranked-then-dead slugs (data/evergreen-events.json → manifest
// `evergreen`) serve a permanent 200 recap page and must never 410 — the
// exemption has to beat BOTH dead paths: endedSet (slugs still in the rolling
// history) and the slug-date heuristic (dated slugs already pruned from it).

const EVERGREEN_NOW = Date.UTC(2026, 7, 1); // 2026-08-01, all dates far past

test("an evergreen dated slug pruned from history is noindex-shell, not gone", () => {
  const catalog = {
    liveSet: new Set(),
    liveEnds: {},
    endedSet: new Set(),
    evergreenSet: new Set(["hillsborough-memorial-day-parade-2026-05-25"]),
  };
  // Without the exemption, the slug-date heuristic (May 25 + grace, long
  // elapsed by Aug 1) would say "gone".
  assert.equal(
    missingPageDisposition("event", "hillsborough-memorial-day-parade-2026-05-25", EVERGREEN_NOW, catalog),
    "noindex-shell",
  );
});

test("an evergreen undated slug still in the ended history is noindex-shell, not gone", () => {
  const catalog = {
    liveSet: new Set(),
    liveEnds: {},
    endedSet: new Set(["bluey-bash-central-library"]),
    evergreenSet: new Set(["bluey-bash-central-library"]),
  };
  assert.equal(
    missingPageDisposition("event", "bluey-bash-central-library", EVERGREEN_NOW, catalog),
    "noindex-shell",
  );
});

test("a non-evergreen ended slug keeps the exact 410 behavior (regression guard)", () => {
  const catalog = {
    liveSet: new Set(),
    liveEnds: {},
    endedSet: new Set(["some-other-fair-2026-05-25"]),
    evergreenSet: new Set(["hillsborough-memorial-day-parade-2026-05-25"]),
  };
  assert.equal(
    missingPageDisposition("event", "some-other-fair-2026-05-25", EVERGREEN_NOW, catalog),
    "gone",
  );
});
