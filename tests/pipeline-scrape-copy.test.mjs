import test from "node:test";
import assert from "node:assert/strict";
import {
  extractJsonLdEvents,
  normalizeScrapedDescription,
  normalizeScrapedTitle,
} from "../scripts/eventPipeline.mjs";

test("normalizeScrapedTitle strips duplicated time/date chrome (BubbleFest audit case)", () => {
  assert.equal(
    normalizeScrapedTitle("10:00 am - 4:30 pm BubbleFest June 13 @ 10:00 am - 4:30 pm BubbleFest"),
    "BubbleFest",
  );
  // A title that is nothing but clock times is garbage, not a title.
  assert.equal(normalizeScrapedTitle("10:00 am - 4:30 pm"), "");
});

test("normalizeScrapedTitle strips Image / Registration Required prefixes", () => {
  assert.equal(
    normalizeScrapedTitle("Image Registration Required Family Paint Night"),
    "Family Paint Night",
  );
  assert.equal(normalizeScrapedTitle("Registration Required Teen Crafts"), "Teen Crafts");
});

test("normalizeScrapedDescription repairs truncated copy and drops date preludes", () => {
  assert.equal(
    normalizeScrapedDescription("oin us for a morning of bubbles and music.", "BubbleFest"),
    "Join us for a morning of bubbles and music.",
  );
  assert.equal(
    normalizeScrapedDescription("June 13 @ 10:00 am - 4:30 pm Come play.", ""),
    "Come play.",
  );
  // Title duplicated at the head of the description is removed.
  assert.equal(
    normalizeScrapedDescription("BubbleFest — a morning of bubbles.", "BubbleFest"),
    "a morning of bubbles.",
  );
});

const fillmoreSource = {
  id: "the-fillmore",
  name: "The Fillmore",
  url: "https://www.livenation.com/venue/the-fillmore",
  city: "San Francisco",
  lat: 37.784,
  lon: -122.433,
};

function jsonLdHtml(body) {
  return `<script type="application/ld+json">${body}</script>`;
}

test("extractJsonLdEvents matches schema.org Event subtypes (MusicEvent)", () => {
  const html = jsonLdHtml(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: "Khruangbin",
    startDate: "2026-07-10T20:00:00-07:00",
    url: "https://www.livenation.com/event/khruangbin",
    location: {
      "@type": "MusicVenue",
      name: "The Fillmore",
      address: { addressLocality: "San Francisco" },
      geo: { latitude: 37.784, longitude: -122.433 },
    },
  }));
  const events = extractJsonLdEvents(html, fillmoreSource);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Khruangbin");
  assert.equal(events[0].venue, "The Fillmore");
  assert.equal(events[0].category, "Music");
  // The adult gate still runs: a MusicEvent at a music venue qualifies for
  // the adults feed instead of being downgraded to kids.
  assert.deepEqual(events[0].audiences, ["all"]);
});

test("extractJsonLdEvents matches subtypes inside @graph and @type arrays", () => {
  const html = jsonLdHtml(JSON.stringify({
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": ["Event", "ComedyEvent"],
        name: "Stand-up Showcase",
        startDate: "2026-07-11T19:30:00-07:00",
        url: "https://www.livenation.com/event/stand-up-showcase",
        location: { name: "Punch Line SF", geo: { latitude: 37.7946, longitude: -122.3999 } },
      },
      {
        "@type": "BreadcrumbList",
        name: "Home",
      },
    ],
  }));
  const events = extractJsonLdEvents(html, fillmoreSource);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Stand-up Showcase");
  assert.equal(events[0].category, "Comedy");
});

test("extractJsonLdEvents maps ChildrensEvent to the kids audience", () => {
  const html = jsonLdHtml(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "ChildrensEvent",
    name: "Puppet Matinee",
    startDate: "2026-07-12T10:00:00-07:00",
    url: "https://example.org/puppet-matinee",
    location: { name: "Community Hall", geo: { latitude: 37.78, longitude: -122.41 } },
  }));
  const events = extractJsonLdEvents(html, fillmoreSource);
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].audiences, ["kids"]);
});

test("extractJsonLdEvents still ignores non-event JSON-LD types", () => {
  const html = jsonLdHtml(JSON.stringify({
    "@context": "https://schema.org",
    "@type": "Product",
    name: "Gift Card",
  }));
  assert.deepEqual(extractJsonLdEvents(html, fillmoreSource), []);
});
