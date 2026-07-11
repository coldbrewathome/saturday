import { test } from "node:test";
import assert from "node:assert/strict";
import {
  formatWeekendRange,
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
