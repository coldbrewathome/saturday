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

// --- junk-1: word-boundary truncation ---------------------------------------

test("truncateAtBoundary cuts on a complete word and appends an ellipsis", async () => {
  const { truncateAtBoundary } = await import("../scripts/eventPipeline.mjs");
  const long = Array.from({ length: 100 }, (_, i) => `word${i}`).join(" ").slice(0, 500);
  const cut = truncateAtBoundary(long, 360);
  assert.ok(cut.length <= 360, `length ${cut.length} > 360`);
  assert.ok(cut.endsWith("…"), "ends with ellipsis");
  const lastWord = cut.slice(0, -1).split(" ").pop();
  assert.ok(long.split(" ").includes(lastWord), `"${lastWord}" is a complete word`);
});

test("truncateAtBoundary leaves short text untouched (no ellipsis)", async () => {
  const { truncateAtBoundary } = await import("../scripts/eventPipeline.mjs");
  const short = "a".repeat(150) + " " + "b".repeat(49); // 200 chars
  assert.equal(truncateAtBoundary(short, 360), short);
});

test("normalizeScrapedDescription caps at 360 on a word boundary", async () => {
  const { normalizeScrapedDescription } = await import("../scripts/eventPipeline.mjs");
  const long = Array.from({ length: 90 }, (_, i) => `token${i}`).join(" ");
  const out = normalizeScrapedDescription(long, "Some Title");
  assert.ok(out.length <= 360);
  assert.ok(out.endsWith("…"));
  assert.ok(!/\S{1,}tok$/.test(out.slice(0, -1)), "no mid-word cut");
});

// Gate regression: raising the pre-clean cap must not weaken the adult-signal
// gate — an adult term deep in the description still rejects the event for a
// kids-audience source.
test("junk-1 gate regression: adult term at char ~300 still rejects for kids source", async () => {
  const { normalizeRawEvent } = await import("../scripts/eventPipeline.mjs");
  const padding = Array.from({ length: 60 }, (_, i) => `fun${i}`).join(" ").slice(0, 295);
  const description = `${padding} brewery tour for grown-ups afterwards.`;
  const event = normalizeRawEvent(
    {
      title: "Neighborhood Afternoon Social",
      description,
      startDateTime: "2099-05-01T10:00:00-07:00",
    },
    { id: "kids-src", name: "Kids Source", city: "Oakland", audiences: ["kids"] },
  );
  assert.equal(event, null);
});

// --- junk-2: named HTML entities --------------------------------------------

test("decodeHtmlEntities decodes the feed-observed named entities", async () => {
  const { decodeHtmlEntities } = await import("../scripts/eventPipeline.mjs");
  assert.equal(
    decodeHtmlEntities("It&rsquo;s 9:00 AM&mdash;12:45"),
    "It’s 9:00 AM—12:45",
  );
  assert.equal(decodeHtmlEntities("caf&eacute; &bull; ni&ntilde;os"), "café • niños");
  // Unknown entities pass through untouched.
  assert.equal(decodeHtmlEntities("keep &foobar; as-is"), "keep &foobar; as-is");
});

// --- junk-3: RFC 5545 unescaping in ICS fields ------------------------------

test("extractIcsEvents unescapes RFC 5545 text (backslash-comma, backslash-n)", async () => {
  const { extractIcsEvents } = await import("../scripts/eventPipeline.mjs");
  const ics = [
    "BEGIN:VCALENDAR",
    "BEGIN:VEVENT",
    "SUMMARY:Comedy Night Fundraiser",
    "DTSTART:20990110T190000",
    "DESCRIPTION:Line one\\nLine two",
    "LOCATION:Laughing Skull Lounge\\, 878 Peachtree Street\\, Atlanta",
    "END:VEVENT",
    "END:VCALENDAR",
  ].join("\r\n");
  const events = extractIcsEvents(ics, { id: "test-ics", name: "Test", city: "Atlanta", audiences: ["all"] });
  assert.equal(events.length, 1);
  assert.equal(events[0].venue, "Laughing Skull Lounge, 878 Peachtree Street, Atlanta");
  assert.equal(events[0].description, "Line one Line two");
});

// --- junk-5: ALLCAPS titles --------------------------------------------------

test("titleCaseAllCaps sentence-cases shouting titles", async () => {
  const { titleCaseAllCaps } = await import("../scripts/eventPipeline.mjs");
  assert.equal(titleCaseAllCaps("STEVE-O: CRASH & BURN"), "Steve-O: Crash & Burn");
  assert.equal(
    titleCaseAllCaps("FOUR SQUARE VOL. 2 - A HIP-HOP VIDEO GAME LIVE THEATRE EXPERIENCE"),
    "Four Square Vol. 2 - a Hip-Hop Video Game Live Theatre Experience",
  );
  // Tokens containing digits stay untouched.
  assert.equal(titleCaseAllCaps("E11EVEN MIAMI NIGHT"), "E11EVEN Miami Night");
  // Normal mixed-case titles are unchanged.
  assert.equal(titleCaseAllCaps("Family Story Time"), "Family Story Time");
  // Short acronyms are unchanged.
  assert.equal(titleCaseAllCaps("LEGO"), "LEGO");
});
