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

// --- matchAnnualLiveEvent ----------------------------------------------------

test("matchAnnualLiveEvent links only generated pages, by match regex", async () => {
  const { matchAnnualLiveEvent } = await import("../scripts/generate-seo-pages.mjs");
  const a = { title: "Hayes Valley Carnival (116th Annual)" };
  const b = { title: "Bastille Day SF Festival" };
  const lookup = new Map([[a, "hvc-2027"], [b, "bastille-2027"]]);
  const entry = { title: "Hayes Valley Carnival", match: "hayes valley carnival" };
  const hit = matchAnnualLiveEvent(entry, [a, b], lookup, new Set(["hvc-2027"]));
  assert.equal(hit.slug, "hvc-2027");
  // not generated -> no link
  assert.equal(matchAnnualLiveEvent(entry, [a, b], lookup, new Set()), null);
  // bad regex entry never throws
  assert.equal(matchAnnualLiveEvent({ title: "x", match: "(" }, [a], lookup, null), null);
});

// --- wkd-2: weekend window ---------------------------------------------------

test("formatWeekendRange handles a Fri–Sun span", () => {
  const fri = new Date(Date.UTC(2026, 7, 7, 12));
  const sun = new Date(Date.UTC(2026, 7, 9, 12));
  assert.equal(formatWeekendRange(fri, sun, "America/Los_Angeles"), "August 7–9");
});

test("getWeekendDateKeys includes Friday only on opt-in and anchors Sunday builds to the weekend in progress", async () => {
  const { getWeekendDateKeys } = await import("../scripts/generate-seo-pages.mjs");
  // Wednesday 2026-08-05 → upcoming weekend Fri 8/7 – Sun 8/9.
  const wed = new Date(Date.UTC(2026, 7, 5, 19));
  const midweek = getWeekendDateKeys(wed, "America/Los_Angeles", { includeFriday: true });
  assert.equal(midweek.fridayKey, "2026-08-07");
  assert.equal(midweek.saturdayKey, "2026-08-08");
  assert.equal(midweek.sundayKey, "2026-08-09");
  assert.deepEqual([...midweek.keys].sort(), ["2026-08-07", "2026-08-08", "2026-08-09"]);
  // Default (no opt-in) keeps the Sat+Sun window for hub/localized callers.
  const defaultKeys = getWeekendDateKeys(wed, "America/Los_Angeles");
  assert.deepEqual([...defaultKeys.keys].sort(), ["2026-08-08", "2026-08-09"]);
  // Sunday 2026-08-09 (noon PT) anchors to YESTERDAY's Saturday, not +6 days.
  const sun = new Date(Date.UTC(2026, 7, 9, 19));
  const sundayBuild = getWeekendDateKeys(sun, "America/Los_Angeles", { includeFriday: true });
  assert.equal(sundayBuild.saturdayKey, "2026-08-08");
  assert.equal(sundayBuild.sundayKey, "2026-08-09");
  assert.equal(sundayBuild.todayKey, "2026-08-09");
});

// --- wkd-3: session rollup + junk-title guard --------------------------------

test("rollupWeekendSessions groups same title+venue+day sessions into one card", async () => {
  const { rollupWeekendSessions } = await import("../scripts/generate-seo-pages.mjs");
  const mk = (title, venue, start) => ({ title, venue, startDateTime: start });
  const events = [
    mk("Play and Explore", "Kidspace", "2026-08-08T09:00:00-07:00"),
    mk("Play and Explore", "Kidspace", "2026-08-08T09:30:00-07:00"),
    mk("Play and Explore", "Kidspace", "2026-08-08T10:00:00-07:00"),
    mk("Play and Explore", "Kidspace", "2026-08-09T09:00:00-07:00"), // other day → own card
    mk("Play and Explore", "Other Hall", "2026-08-08T09:00:00-07:00"), // other venue → own card
    mk("9:00 am - 9:45 am Play and Explore", "Kidspace", "2026-08-08T10:30:00-07:00"), // time-prefix strips into the group
  ];
  const rolled = rollupWeekendSessions(events, "America/Los_Angeles");
  assert.equal(rolled.length, 3);
  assert.equal(rolled[0].sessionStarts.length, 4);
  assert.ok(!rolled[1].sessionStarts, "single-session events carry no sessionStarts");
});

test("isJunkEventTitle flags time/date-as-title junk; displayEventTitle substitutes venue+category", async () => {
  const { isJunkEventTitle, displayEventTitle } = await import("../scripts/generate-seo-pages.mjs");
  assert.equal(isJunkEventTitle("10 a.m. – 5 p.m."), true);
  assert.equal(isJunkEventTitle("10:00 am - 4:30 pm"), true);
  assert.equal(isJunkEventTitle("July 12"), true);
  assert.equal(isJunkEventTitle("10 Fun Crafts for Kids"), false);
  assert.equal(isJunkEventTitle("Family Story Time"), false);
  assert.equal(
    displayEventTitle({ title: "10 a.m. – 5 p.m.", venue: "Burke Museum Events", category: "Museum" }),
    "Burke Museum — Museum day",
  );
  assert.equal(displayEventTitle({ title: "Family Story Time" }), "Family Story Time");
});

// --- junk-6: display-time venue de-sourcing ----------------------------------

test("displayVenue strips calendar suffixes only when a real venue remains", async () => {
  const { displayVenue } = await import("../scripts/generate-seo-pages.mjs");
  assert.equal(displayVenue("Children's Museum of Atlanta Events"), "Children's Museum of Atlanta");
  assert.equal(displayVenue("The Seattle Public Library Story Time Calendar"), "The Seattle Public Library Story Time");
  assert.equal(displayVenue("Special Events"), "Special Events");
  assert.equal(displayVenue("Golden Gate Park"), "Golden Gate Park");
  assert.equal(displayVenue({ venue: "Phoenix Public Library Program Calendar" }), "Phoenix Public Library");
});

// --- evt-5 / junk-6 / junk-7: Event JSON-LD accuracy --------------------------

test("buildEventJsonLd emits no logo fallback image, cleans location.name, keeps URL", async () => {
  const { buildEventJsonLd } = await import("../scripts/generate-seo-pages.mjs");
  const node = buildEventJsonLd(
    {
      title: "Toddler Tales",
      venue: "Children's Museum of Atlanta Events",
      city: "Atlanta",
      startDateTime: "2099-05-02T10:00:00-04:00",
      description: "A gentle storytime for walkers and pre-walkers with songs and bubbles.",
    },
    "https://famhop.com/atlanta/event/toddler-tales-childrens-museum-of-atlanta-events/",
  );
  assert.equal(node.image, undefined, "no sitewide-logo Event.image fallback");
  assert.equal(node.location.name, "Children's Museum of Atlanta");
  assert.equal(node.url, "https://famhop.com/atlanta/event/toddler-tales-childrens-museum-of-atlanta-events/");
  assert.equal(node.eventAttendanceMode, "https://schema.org/OfflineEventAttendanceMode");
});

test("buildEventJsonLd flags Zoom titles as online events with a VirtualLocation", async () => {
  const { buildEventJsonLd } = await import("../scripts/generate-seo-pages.mjs");
  const node = buildEventJsonLd(
    {
      title: "Homework Help over Zoom",
      venue: "Somerville Public Library",
      city: "Somerville",
      startDateTime: "2099-05-02T16:00:00-04:00",
      url: "https://example.org/zoom-homework",
    },
    "https://famhop.com/boston/event/homework-help-over-zoom/",
  );
  assert.equal(node.eventAttendanceMode, "https://schema.org/OnlineEventAttendanceMode");
  assert.equal(node.location["@type"], "VirtualLocation");
  assert.equal(node.location.url, "https://example.org/zoom-homework");
  // A description that merely mentions zoom does NOT flip the mode.
  const offline = buildEventJsonLd(
    { title: "Storytime", description: "We zoom around the room!", venue: "Library", city: "Boston", startDateTime: "2099-05-02T10:00:00-04:00" },
    "https://famhop.com/boston/event/storytime/",
  );
  assert.equal(offline.eventAttendanceMode, "https://schema.org/OfflineEventAttendanceMode");
});

// --- junk-7: per-source boilerplate descriptions ------------------------------

test("buildBoilerplateDescriptionKeys flags a desc shared by >=4 titles in one source only", async () => {
  const { buildBoilerplateDescriptionKeys } = await import("../scripts/generate-seo-pages.mjs");
  const blob = "children family kids museum science art workshop";
  const mk = (title, sourceId, description) => ({ title, sourceId, description });
  const events = [
    mk("A", "src-1", blob), mk("B", "src-1", blob), mk("C", "src-1", blob),
    mk("D", "src-1", blob), mk("E", "src-1", blob),
    mk("F", "src-2", "Shared by two"), mk("G", "src-2", "Shared by two"),
  ];
  const keys = buildBoilerplateDescriptionKeys(events);
  assert.equal(keys.has(`src-1|${blob}`), true);
  assert.equal(keys.has("src-2|shared by two"), false);
});

// --- ann-1: annual page year -------------------------------------------------

test("annualPageYear rolls to next year once the (first) month has passed", async () => {
  const { annualPageYear } = await import("../scripts/generate-seo-pages.mjs");
  const nov = new Date(Date.UTC(2026, 10, 15, 12));
  assert.equal(annualPageYear("July", nov), 2027);
  assert.equal(annualPageYear("December", nov), 2026);
  const feb = new Date(Date.UTC(2026, 1, 10, 12));
  assert.equal(annualPageYear("June–July", feb), 2026, "en-dash range parses first token");
  assert.equal(annualPageYear("July–August", feb), 2026);
  assert.equal(annualPageYear("August or September", feb), 2026);
  assert.equal(annualPageYear("June–August", nov), 2027);
  // Unparseable month → null → caller skips the year.
  assert.equal(annualPageYear("Seasonal", feb), null);
  assert.equal(annualPageYear("", feb), null);
});
