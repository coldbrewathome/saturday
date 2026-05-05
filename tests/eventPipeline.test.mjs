import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEventsDataset,
  expandRecurringTemplates,
  extractHtmlEvents,
  extractIcsEvents,
  extractLibCalEvents,
  extractJsonLdEvents,
  inferAgeBands,
  parseLooseDate,
  validateEventsDataset,
} from "../scripts/eventPipeline.mjs";

const source = {
  id: "sfpl",
  name: "San Francisco Public Library",
  url: "https://sfpl.org/events",
  city: "San Francisco",
  category: "Library",
  lat: 37.7796,
  lon: -122.4159,
};

test("extractJsonLdEvents normalizes schema.org events", () => {
  const html = `
    <script type="application/ld+json">
      {
        "@context": "https://schema.org",
        "@type": "Event",
        "name": "Family Storytime",
        "description": "Stories for toddler and preschool families.",
        "startDate": "2026-05-09T10:30:00-07:00",
        "endDate": "2026-05-09T11:00:00-07:00",
        "url": "https://sfpl.org/events/family-storytime",
        "location": {
          "name": "SF Main Library",
          "address": { "addressLocality": "San Francisco" },
          "geo": { "latitude": 37.7796, "longitude": -122.4159 }
        }
      }
    </script>
  `;

  const events = extractJsonLdEvents(html, source);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Family Storytime");
  assert.equal(events[0].venue, "SF Main Library");
  assert.equal(events[0].category, "Library");
  assert.deepEqual(events[0].ageBands, ["toddler", "preschool"]);
  assert.equal(events[0].extractionMethod, "json-ld");
});

test("extractIcsEvents reads VEVENT records", () => {
  const ics = `BEGIN:VCALENDAR
BEGIN:VEVENT
SUMMARY:LEGO Club
DESCRIPTION:Build session for kids and tweens
DTSTART:20260510T140000
DTEND:20260510T150000
LOCATION:Main Library
URL:https://example.org/lego
END:VEVENT
END:VCALENDAR`;

  const events = extractIcsEvents(ics, source);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "LEGO Club");
  assert.deepEqual(events[0].ageBands, ["school-age", "tween"]);
  assert.equal(events[0].timeWindow, "Afternoon");
});

test("extractLibCalEvents reads San Mateo LibCal results", () => {
  const events = extractLibCalEvents(
    {
      results: [
        {
          id: 15643591,
          title: "Baby Storytime",
          description: "Stories, songs and rhymes for babies and caregivers.",
          startdt: "2026-05-05 10:15:00",
          enddt: "2026-05-05 11:30:00",
          location: "Oak Room Patio, Main Library 1st Floor",
          url: "https://sanmateopublic.libcal.com/event/15643591",
          audiences: [{ name: "Baby (0-18 mos)" }],
          categories_arr: [{ name: "Storytime" }],
        },
      ],
    },
    {
      id: "san-mateo-library",
      name: "San Mateo Public Library",
      url: "https://sanmateopublic.libcal.com/calendar/adults-teens?cid=16089&t=g&d=0000-00-00&cal=16089&inc=0",
      city: "San Mateo",
      category: "Library",
      lat: 37.5685,
      lon: -122.3247,
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Baby Storytime");
  assert.equal(events[0].venue, "Oak Room Patio, Main Library 1st Floor");
  assert.deepEqual(events[0].ageBands, ["toddler"]);
  assert.equal(events[0].extractionMethod, "libcal");
});

test("extractHtmlEvents finds dated event cards and skips undated links", () => {
  const html = `
    <article class="event-card">
      <h3><a href="/event/craft">Family Craft Workshop</a></h3>
      <time datetime="2026-05-09T14:00:00-07:00">May 9</time>
      <p>Free craft activity for kids ages 6-10.</p>
    </article>
    <article>
      <h3><a href="/visit">Visit the museum</a></h3>
      <p>Open every day.</p>
    </article>
  `;

  const events = extractHtmlEvents(html, source);
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Family Craft Workshop");
  assert.equal(events[0].url, "https://sfpl.org/event/craft");
});

test("expandRecurringTemplates creates dated events inside the planning window", () => {
  const events = expandRecurringTemplates(
    [
      {
        id: "sfpl-main-storytime",
        title: "Family Storytime",
        description: "Songs and books for kids 0-5.",
        venue: "SF Main Library",
        city: "San Francisco",
        neighborhood: "Civic Center",
        lat: 37.7796,
        lon: -122.4159,
        category: "Library",
        daysOfWeek: [6],
        timeWindow: "Morning",
        ageBands: ["toddler", "preschool"],
        cost: "Free",
        url: "https://sfpl.org/events",
        verified: false,
      },
    ],
    source,
    { now: "2026-05-04T12:00:00Z", windowDays: 14, maxOccurrencesPerTemplate: 2 },
  );

  assert.equal(events.length, 2);
  assert.equal(events[0].id, "sfpl-main-storytime-2026-05-09");
  assert.equal(events[0].sourceMode, "recurring-template");
  assert.equal(events[0].startDateTime, "2026-05-09T17:00:00.000Z");
});

test("validateEventsDataset rejects adult-only events and accepts generated events", () => {
  const dataset = buildEventsDataset(
    [
      {
        id: "family-event",
        title: "Family Science Day",
        description: "Hands-on science for kids.",
        venue: "Science Museum",
        city: "San Francisco",
        neighborhood: "Embarcadero",
        lat: 37.8,
        lon: -122.4,
        category: "Museum",
        daysOfWeek: [6],
        timeWindow: "Morning",
        startDateTime: "2026-05-09T10:00:00-07:00",
        endDateTime: "2026-05-09T11:00:00-07:00",
        ageBands: ["school-age"],
        cost: "Free",
        url: "https://example.org/family",
        verified: true,
      },
    ],
    { sourceCount: 1 },
  );

  assert.equal(
    validateEventsDataset(dataset, { minEvents: 1, cities: ["San Francisco"] }).length,
    0,
  );

  dataset.events[0].title = "21+ cocktail night";
  assert.match(validateEventsDataset(dataset, { minEvents: 1 })[0], /adult-only/);
});

test("inferAgeBands and parseLooseDate handle common calendar text", () => {
  assert.deepEqual(inferAgeBands("Baby lapsit for ages 0-3"), ["toddler"]);
  assert.equal(parseLooseDate("Family day on May 9, 2026 at 2pm"), "2026-05-09T14:00:00-07:00");
});
