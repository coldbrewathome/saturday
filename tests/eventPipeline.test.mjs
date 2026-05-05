import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEventsDataset,
  expandRecurringTemplates,
  extractBiblioEvents,
  extractDrupalCardEvents,
  extractEventListEvents,
  extractHtmlEvents,
  extractIcsEvents,
  extractLibCalEvents,
  extractLibraryCalendarEvents,
  extractJsonLdEvents,
  extractOfficialTextEvents,
  inferAgeBands,
  parseDateTimeRange,
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

test("extractBiblioEvents parses BiblioCommons event cards", () => {
  const html = `
    <main>
      <h2>Event items</h2>
      <h3><a href="/v2/events/abc123">Toddler Storytime</a></h3>
      <p>Monday, May 11 on May 11, 2026, 10:30am–11:00am 10:30am to 11:00am</p>
      <a href="https://example.org/branch">Main Children's Room Event location: Main Children's Room</a>
      <p>Songs, active rhymes and stories especially for ages 18 months to 3 years.</p>
      <ul><li>Storytime Find more events in: Storytime</li><li>Families</li><li>Kids</li></ul>
    </main>
  `;

  const events = extractBiblioEvents(html, {
    ...source,
    id: "oakland-library",
    name: "Oakland Public Library",
    url: "https://oaklandlibrary.bibliocommons.com/v2/events?audiences=60af9e2d8509742400e6e8ed",
    sourceType: "biblioevents",
  }, { now: new Date("2026-05-05T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Toddler Storytime");
  assert.equal(events[0].venue, "Main Children's Room");
  assert.equal(events[0].extractionMethod, "biblioevents");
});

test("extractLibraryCalendarEvents parses LibraryCalendar cards", () => {
  const html = `
    <div class="lc-event event-card lc-featured-event">
      <div class="lc-featured-event-content">
        <h2><a href="/event/saturday-storytime-28925">Saturday Storytime</a></h2>
        <div class="lc-featured-event-info-item lc-featured-event-info-item--date">
          Saturday, May 9, 2026 at 11:00am - 11:30am
        </div>
        <div class="lc-featured-event-location">John Pappas Legacy Room at Weekes Branch</div>
        <div class="lc-event__age-groups">
          <strong>Age Group:</strong><span>Babies &amp; Toddlers</span>, <span>Preschoolers</span>, <span>Kids</span>, <span>Families</span>
        </div>
        <div class="lc-event__body"><div class="field-item"><p>Stories, songs, and movement for kids.</p></div></div>
      </div>
    </div>
  `;

  const events = extractLibraryCalendarEvents(html, {
    id: "hayward-library",
    name: "Hayward Public Library",
    url: "https://hayward.librarycalendar.com/events/month",
    city: "Hayward",
    category: "Library",
    sourceType: "librarycalendar",
  }, { now: new Date("2026-05-05T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Saturday Storytime");
  assert.equal(events[0].city, "Hayward");
  assert.equal(events[0].extractionMethod, "librarycalendar");
});

test("extractDrupalCardEvents parses Drupal Views AJAX cards", () => {
  const html = `
    <div class="col--6">
      <div class="collection-card collection-card--horizontal-card collection-card--event collection-card--icon">
        <a href="https://apm.activecommunities.com/ebparks/Activity_Search/59286" class="collection-card__link">
          <div class="event-type-label event-type-label--drop-in-program event-type-label--with-icon">Drop-in Program</div>
          <div class="collection-card__inner">
            <h3 class="collection-card__title">Story Time</h3>
            <div class="collection-card__teaser">
              <time datetime="2026-05-08T17:30:00Z" class="datetime">Friday, May. 8, 2026, 10:30 AM</time>
              <span class="teaser__tag teaser__tag--related-park">Crown Beach</span>, Alameda
            </div>
          </div>
        </a>
      </div>
    </div>
  `;

  const events = extractDrupalCardEvents(html, {
    id: "east-bay-parks",
    name: "East Bay Regional Park District",
    url: "https://www.ebparks.org/calendar",
    city: "Oakland",
    category: "Park",
    sourceType: "drupalViewsAjax",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Story Time");
  assert.equal(events[0].venue, "Crown Beach");
  assert.equal(events[0].city, "Alameda");
  assert.equal(events[0].extractionMethod, "drupal-views-ajax");
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

test("extractEventListEvents reads official festival list pages", () => {
  const html = `
    <section>
      <h2>June 2026</h2>
      <p>Fri, Jun 5, 11:00am - 11:30am</p>
      <h3><a href="/event/manilatown">Manilatown Ancestral Ensemble (Kids' Show)</a></h3>
      <p>Free outdoor performance for children and adults.</p>
    </section>
  `;

  const events = extractEventListEvents(html, {
    id: "ybg-kids",
    name: "Yerba Buena Gardens Festival",
    url: "https://ybgfestival.org/childrens-garden-series/",
    city: "San Francisco",
    category: "Festival",
    eventList: {
      venue: "Children's Garden, Yerba Buena Gardens",
      defaultAudienceText: "children kids family all ages",
    },
  }, { now: new Date("2026-05-05T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Manilatown Ancestral Ensemble (Kids' Show)");
  assert.equal(events[0].venue, "Children's Garden, Yerba Buena Gardens");
  assert.equal(events[0].extractionMethod, "event-list");
});

test("extractOfficialTextEvents verifies configured festival events from page text", () => {
  const html = `
    <main>
      <h1>Festival FAQs</h1>
      <p>The festival is on May 23 & May 24, 2026.</p>
      <p>The festival opens at 11 AM and closes at 6 PM.</p>
    </main>
  `;

  const events = extractOfficialTextEvents(html, {
    id: "carnaval-sf",
    name: "Carnaval San Francisco",
    url: "https://carnavalsanfrancisco.org/faq/",
    city: "San Francisco",
    category: "Festival",
    officialTextEvents: [
      {
        title: "Carnaval San Francisco Festival",
        description: "Free Mission District festival with a kids zone.",
        venue: "Harrison Street, Mission District",
        startDateTime: "2026-05-23T11:00:00-07:00",
        endDateTime: "2026-05-23T18:00:00-07:00",
        ageBands: ["preschool", "school-age", "tween"],
        cost: "Free",
        requiredPattern: "May 23\\s*&\\s*May 24, 2026",
      },
    ],
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Carnaval San Francisco Festival");
  assert.equal(events[0].extractionMethod, "official-text-event");
});

test("extractOfficialTextEvents expands verified monthly community events", () => {
  const html = `
    <main>
      <p>Held on the first Friday of every month from 5-9 PM along Telegraph Avenue.</p>
      <p>This street festival is free, family-friendly, and inclusive.</p>
    </main>
  `;

  const events = extractOfficialTextEvents(html, {
    id: "oakland-first-fridays",
    name: "Oakland First Fridays",
    url: "https://www.oaklandfirstfridays.org/about",
    city: "Oakland",
    category: "Community",
    officialRecurringEvents: [
      {
        id: "oakland-first-fridays",
        title: "Oakland First Fridays",
        description: "Monthly art, food, music, and culture street festival.",
        venue: "Telegraph Avenue between 22nd and 27th Streets",
        startTime: "17:00",
        endTime: "21:00",
        ageBands: ["preschool", "school-age", "tween"],
        cost: "Free",
        requiredText: ["first Friday of every month", "family-friendly"],
        recurrence: { frequency: "monthly", weekOfMonth: 1, dayOfWeek: 5 },
      },
    ],
  }, { now: new Date("2026-05-05T12:00:00Z"), windowDays: 45 });

  assert.equal(events.length, 1);
  assert.equal(events[0].startDateTime, "2026-06-06T00:00:00.000Z");
  assert.equal(events[0].extractionMethod, "official-recurring-event");
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
  assert.deepEqual(parseDateTimeRange("Sunday, June 14, 9am - 12pm"), {
    startDateTime: "2026-06-14T09:00:00-07:00",
    endDateTime: "2026-06-14T12:00:00-07:00",
  });
});
