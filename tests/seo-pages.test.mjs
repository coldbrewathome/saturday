import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auditAdultsSitemapUrls,
  formatWeekendRange,
  sitemapUrlViolatesD3,
  spotPassesQualityGate,
  weekendGuideTitle,
} from "../scripts/generate-seo-pages.mjs";

// --- spotPassesQualityGate -------------------------------------------------

test("quality gate rejects junk fast-food chains by name", () => {
  for (const name of ["Arby's", "Arbys", "McDonald's", "Taco Bell", "Subway", "Starbucks"]) {
    assert.equal(
      spotPassesQualityGate({ name, category: "Food" }, { metroHasRatings: false }),
      false,
      name,
    );
  }
});

test("quality gate rejects big-box gyms for the kids audience", () => {
  const spot = { name: "UFC Gym Concord", category: "Community" };
  assert.equal(spotPassesQualityGate(spot, { adults: false, metroHasRatings: false }), false);
});

test("quality gate accepts a rated venue in a rated metro", () => {
  const spot = {
    name: "Exploratorium",
    category: "Culture",
    googleRating: 4.7,
    googleRatingCount: 1200,
  };
  assert.equal(spotPassesQualityGate(spot, { metroHasRatings: true }), true);
});

test("quality gate drops unrated spots when the metro has rating data", () => {
  const spot = { name: "Some Unrated Place", category: "Outdoors" };
  assert.equal(spotPassesQualityGate(spot, { metroHasRatings: true }), false);
});

// D3 backstop: brand-safety and kids-primary-venue gates are never
// bypassable, even by the featured-spot exemption.
test("quality gate blocks brand-unsafe kids spots even when featured", () => {
  const gunRange = { name: "Range USA", category: "Shopping" };
  assert.equal(
    spotPassesQualityGate(gunRange, { adults: false, featured: true }),
    false,
  );
});

test("quality gate blocks weapons/cannabis-retail and kids-primary venues for adults", () => {
  const dispensary = { name: "Barbary Coast", category: "Shopping", tags: ["cannabis"] };
  const playground = { name: "Raymond Kimbell Playground", category: "Outdoors" };
  assert.equal(spotPassesQualityGate(dispensary, { adults: true, featured: true }), false);
  assert.equal(spotPassesQualityGate(playground, { adults: true, featured: true }), false);
});

// E20: D3 sitemap assertion — pure, fixture-testable independent of the real
// build's own output.
test("E20: sitemapUrlViolatesD3 flags playground/children/kids-show/storytime/toddler/preschool URLs", () => {
  const violating = [
    "https://trymosey.com/bay-area/spot/foo-playground-x/",
    "https://trymosey.com/bay-area/spot/childrens-discovery-museum/",
    "https://trymosey.com/bay-area/event/lion-dance-kids-show-x/",
    "https://trymosey.com/bay-area/event/library-storytime-hour/",
  ];
  for (const url of violating) {
    assert.equal(sitemapUrlViolatesD3(url), true, url);
  }
  assert.equal(sitemapUrlViolatesD3("https://trymosey.com/bay-area/spot/top-of-the-mark/"), false);
  assert.deepEqual(auditAdultsSitemapUrls(violating).length, violating.length);
  assert.deepEqual(auditAdultsSitemapUrls(["https://trymosey.com/bay-area/spot/top-of-the-mark/"]), []);
});

test("quality gate keeps unrated spots in metros with no rating data at all", () => {
  const spot = { name: "Neighborhood Playground", category: "Outdoors" };
  assert.equal(spotPassesQualityGate(spot, { metroHasRatings: false }), true);
});

// Restaurants/shops/gyms are pages we cannot win on a kids' site (Yelp and
// Google Maps own those queries), so the kids build publishes Outdoors and
// Culture only. Mosey still needs Food.
test("quality gate drops Food/Shopping/Wellness spots for the kids audience", () => {
  for (const category of ["Food", "Shopping", "Wellness"]) {
    assert.equal(
      spotPassesQualityGate(
        { name: "Some Local Bistro", category, googleRating: 4.6, googleRatingCount: 900 },
        { adults: false, metroHasRatings: true },
      ),
      false,
      category,
    );
  }
});

test("quality gate keeps Food spots for the adults audience", () => {
  const spot = {
    name: "Some Local Bistro",
    category: "Food",
    googleRating: 4.6,
    googleRatingCount: 900,
  };
  assert.equal(spotPassesQualityGate(spot, { adults: true, metroHasRatings: true }), true);
});

test("featured Food spots survive the kids category gate (featured plans link them)", () => {
  const spot = { name: "Ferry Building Marketplace", category: "Food" };
  assert.equal(
    spotPassesQualityGate(spot, { adults: false, metroHasRatings: true, featured: true }),
    true,
  );
});

test("featured/editor's-pick spots bypass the rating requirement", () => {
  const spot = { name: "Hidden Gem Farm", category: "Farm" };
  assert.equal(spotPassesQualityGate(spot, { metroHasRatings: true, featured: true }), true);
});

test("quality gate rejects nameless and category-less spots", () => {
  assert.equal(spotPassesQualityGate({ category: "Park" }, {}), false);
  assert.equal(spotPassesQualityGate({ name: "No Category" }, {}), false);
  assert.equal(spotPassesQualityGate({ name: "Other Cat", category: "other" }, {}), false);
});

// --- guide title shapes ----------------------------------------------------

test("kids weekend guide title is query-shaped", () => {
  assert.equal(
    weekendGuideTitle("Seattle"),
    "Things to do with kids this weekend in Seattle",
  );
});

test("adults weekend guide title is query-shaped", () => {
  assert.equal(
    weekendGuideTitle("San Francisco Bay Area", true),
    "Things to do in San Francisco Bay Area this weekend",
  );
});

test("formatWeekendRange collapses the month within a single month", () => {
  const sat = new Date(Date.UTC(2026, 5, 13, 12));
  const sun = new Date(Date.UTC(2026, 5, 14, 12));
  assert.equal(formatWeekendRange(sat, sun, "America/Los_Angeles"), "June 13–14");
});

test("formatWeekendRange spells out both months across a boundary", () => {
  const sat = new Date(Date.UTC(2026, 9, 31, 12));
  const sun = new Date(Date.UTC(2026, 10, 1, 12));
  assert.equal(
    formatWeekendRange(sat, sun, "America/Los_Angeles"),
    "October 31 – November 1",
  );
});

// --- pickRelatedEvents -------------------------------------------------------

test("pickRelatedEvents prefers same-city events, soonest first", async () => {
  const { pickRelatedEvents } = await import("../scripts/generate-seo-pages.mjs");
  const mk = (title, city, start) => ({ title, city, startDateTime: start });
  const target = mk("Target", "Oakland", "2026-07-20");
  const sorted = [
    mk("A", "Oakland", "2026-07-19"),
    target,
    mk("B", "Berkeley", "2026-07-21"),
    mk("C", "Oakland", "2026-07-22"),
    mk("D", "Fremont", "2026-07-23"),
    mk("E", "Oakland", "2026-07-24"),
    mk("F", "Oakland", "2026-07-25"),
  ];
  const picked = pickRelatedEvents(target, sorted);
  assert.equal(picked.length, 4);
  assert.deepEqual(picked.map((e) => e.title), ["A", "C", "E", "F"]);
  assert.ok(!picked.includes(target), "never links to itself");
});

test("pickRelatedEvents backfills from metro when city has too few", async () => {
  const { pickRelatedEvents } = await import("../scripts/generate-seo-pages.mjs");
  const mk = (title, city, start) => ({ title, city, startDateTime: start });
  const target = mk("Target", "Alameda", "2026-07-20");
  const sorted = [mk("A", "Alameda", "2026-07-21"), target, mk("B", "Berkeley", "2026-07-22")];
  const picked = pickRelatedEvents(target, sorted);
  assert.deepEqual(picked.map((e) => e.title), ["A", "B"]);
});

test("pickRelatedEvents handles an event with no city", async () => {
  const { pickRelatedEvents } = await import("../scripts/generate-seo-pages.mjs");
  const mk = (title, city, start) => ({ title, city, startDateTime: start });
  const target = mk("Target", "", "2026-07-20");
  const sorted = [target, mk("A", "Oakland", "2026-07-21"), mk("B", "Berkeley", "2026-07-22")];
  assert.deepEqual(pickRelatedEvents(target, sorted).map((e) => e.title), ["A", "B"]);
});
