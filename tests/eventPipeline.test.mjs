import test from "node:test";
import assert from "node:assert/strict";
import {
  buildEventsDataset,
  expandRecurringTemplates,
  extractBiblioEvents,
  extractBrooklynLibraryEvents,
  extractCommunicoEvents,
  extractChicagoParkDistrictEvents,
  extractDrupalCardEvents,
  extractEventOnEvents,
  extractEventListEvents,
  extractHtmlEvents,
  extractIcsEvents,
  extractLibCalEvents,
  extractLibraryCalendarEvents,
  extractMidpenTableEvents,
  extractJsonLdEvents,
  extractLocalistEvents,
  extractOpenCitiesEventEvents,
  extractOfficialTextEvents,
  extractPhoenixZooEvents,
  extractSfplEvents,
  extractTicketureEvents,
  extractWebflowEvents,
  extractWpRestEvents,
  extractWwcEvents,
  extractZooAtlantaEvents,
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

test("extractOpenCitiesEventEvents expands multi-date event pages", () => {
  const html = `
    <h1 class="oc-page-title">Playhouse Series: The Three Little Pigs</h1>
    <meta name="description" content="Story-teller style theatre for young audience members, suggested ages two to six years old." />
    <ul class="multi-date-list future-events-list">
      <li class="multi-date-item" data-start-year='2026' data-start-month='05' data-start-day='30' data-end-year='2026' data-end-month='05' data-end-day='30' data-start-hour='10' data-start-mins='00' data-end-hour='11' data-end-mins='00'>
        Saturday, May 30, 2026 | 10:00 AM - 11:00 AM
      </li>
      <li class="multi-date-item" data-start-year='2026' data-start-month='05' data-start-day='30' data-end-year='2026' data-end-month='05' data-end-day='30' data-start-hour='12' data-start-mins='00' data-end-hour='13' data-end-mins='00'>
        Saturday, May 30, 2026 | 12:00 PM - 01:00 PM
      </li>
      <li class="multi-date-item" data-start-year='2026' data-start-month='05' data-start-day='31' data-end-year='2026' data-end-month='05' data-end-day='31' data-start-hour='14' data-start-mins='00' data-end-hour='15' data-end-mins='00'>
        Sunday, May 31, 2026 | 02:00 PM - 03:00 PM
      </li>
    </ul>
    <h3 class="side-box-cost">Cost</h3>
    <p class="side-box-cost">$17</p>
  `;

  const events = extractOpenCitiesEventEvents(html, {
    id: "palo-alto-childrens-theatre",
    name: "Palo Alto Children's Theatre",
    url: "https://www.paloalto.gov/Events-Directory/Community-Services/Playhouse-Series-The-Three-Little-Pigs",
    homeUrl: "https://www.paloalto.gov/Departments/Community-Services/Arts-Sciences/Palo-Alto-Childrens-Theatre",
    city: "Palo Alto",
    neighborhood: "Palo Alto",
    venue: "Palo Alto Children's Theatre",
    category: "Culture",
    sourceType: "openCitiesEvent",
    lat: 37.444752,
    lon: -122.145844,
    defaultAudienceText: "families children toddler preschool theatre performance",
  });

  assert.equal(events.length, 3);
  assert.equal(events[0].title, "Playhouse Series: The Three Little Pigs");
  assert.equal(events[0].startDateTime, "2026-05-30T17:00:00.000Z");
  assert.equal(events[1].startDateTime, "2026-05-30T19:00:00.000Z");
  assert.equal(events[2].startDateTime, "2026-05-31T21:00:00.000Z");
  assert.equal(events[0].cost, "$17");
  assert.equal(events[0].sourceMode, "open-cities-event");
  assert.deepEqual(events[0].ageBands, ["toddler", "preschool", "school-age"]);
});

test("extractSfplEvents parses SFPL Drupal event teasers", () => {
  const html = `
    <div class="views-row"><div class="views-field views-field-rendered-entity"><span class="field-content">
      <article about="/events/2026/05/09/workshop-family-zine-making" class="event event--teaser event--family teaser">
        <div class="event__details">
          <div class="event__main">
            <header class="event__header">
              <div class="event__date">
                <div class="field field--name-field-event-date-and-time field__item">
                  <span class="date-display-range">Saturday, 5/9/2026, 10:30 - 2:00</span>
                </div>
              </div>
              <div class="event__name">
                <h2 class="event__title">
                  <a href="/events/2026/05/09/workshop-family-zine-making" rel="bookmark"><span>Workshop: Family Zine Making</span></a>
                </h2>
              </div>
            </header>
            <div class="event__audience">
              <div class="field field--name-field-event-audience field__items">
                <div class="field__item"><a href="/events?field_event_audience_target_id=28">Family</a></div>
                <div class="field__item"><a href="/events?field_event_audience_target_id=27">Elementary School Age</a></div>
              </div>
            </div>
            <div class="event__topics">
              <div class="field field--name-field-event-topic field__items">
                <div class="field__item"><a href="/events?field_event_topic_target_id=400">Creative Arts</a></div>
              </div>
            </div>
          </div>
          <div class="event__location">
            <div class="field field--name-field-event-location field__items">
              <div class="field__item"><div about="/locations/main-library">
                <a class="location--short-label" href="/locations/main-library">
                  <div class="field field--name-field-short-name field__item">Main</div>
                </a>
              </div></div>
            </div>
          </div>
        </div>
      </article>
    </span></div></div>
    <div class="views-row"><div class="views-field views-field-rendered-entity"><span class="field-content">
      <article about="/events/2026/05/12/storytime-babies" class="event event--teaser event--early-childhood teaser">
        <div class="field field--name-field-event-date-and-time field__item">
          <span class="date-display-range">Tuesday, 5/12/2026, 1:15 - 1:45</span>
        </div>
        <h2 class="event__title">
          <a href="/events/2026/05/12/storytime-babies" rel="bookmark"><span>Storytime: For Babies</span></a>
        </h2>
        <div class="field field--name-field-event-audience field__items">
          <div class="field__item"><a href="/events?field_event_audience_target_id=26">Early Childhood</a></div>
        </div>
        <a class="location--short-label" href="/locations/ingleside">
          <div class="field field--name-field-short-name field__item">Ingleside</div>
        </a>
      </article>
    </span></div></div>
  `;

  const events = extractSfplEvents(html, {
    ...source,
    sourceType: "sfplEvents",
  });

  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Workshop: Family Zine Making");
  assert.equal(events[0].venue, "Main");
  assert.equal(events[0].startDateTime, "2026-05-09T17:30:00.000Z");
  assert.equal(events[0].endDateTime, "2026-05-09T21:00:00.000Z");
  assert.equal(events[0].url, "https://sfpl.org/events/2026/05/09/workshop-family-zine-making");
  assert.equal(events[0].extractionMethod, "sfpl-events");
  assert.deepEqual(events[0].ageBands, ["school-age"]);
  assert.equal(events[1].startDateTime, "2026-05-12T20:15:00.000Z");
  assert.deepEqual(events[1].ageBands, ["toddler"]);
});

test("extractCommunicoEvents parses Berkeley libnet events and branch locations", () => {
  const events = extractCommunicoEvents(
    {
      locations: [
        {
          id: "4046",
          name: "North Branch",
          locality: "Berkeley",
          lat: "37.8854536",
          lon: "-122.2753925",
        },
      ],
      events: [
        {
          id: "15292079",
          title: "Storytime @North",
          sub_title: "",
          description: "Stories, songs, rhymes, and fun!",
          long_description: "<p>This story time is geared towards children ages 2-5.</p>",
          raw_start_time: "2026-06-24 10:30:00",
          raw_end_time: "2026-06-24 11:00:00",
          location: "North Branch",
          location_id: "4046",
          venues: "North Branch Meeting Room",
          agesArray: ["Early Childhood"],
          tagsArray: ["Storytime"],
          search_tagsArray: ["kids"],
          registration_cost: "0",
        },
        {
          id: "15549539",
          title: "Technology Help @Central",
          description: "Drop in tech help for adults.",
          raw_start_time: "2026-06-24 14:00:00",
          raw_end_time: "2026-06-24 15:00:00",
          location: "Central Library",
          location_id: "4044",
          agesArray: ["Adults"],
          tagsArray: ["Computer & Tech Help"],
          registration_cost: "0",
        },
      ],
    },
    {
      id: "berkeley-library",
      name: "Berkeley Public Library",
      url: "https://berkeleypubliclibrary.libnet.info/events",
      city: "Berkeley",
      category: "Library",
      sourceType: "communicoEvents",
      lat: 37.8715,
      lon: -122.273,
    },
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].id, "berkeley-library-15292079");
  assert.equal(events[0].title, "Storytime @North");
  assert.equal(events[0].venue, "North Branch - North Branch Meeting Room");
  assert.equal(events[0].startDateTime, "2026-06-24T17:30:00.000Z");
  assert.equal(events[0].endDateTime, "2026-06-24T18:00:00.000Z");
  assert.deepEqual(events[0].ageBands, ["toddler", "preschool"]);
  assert.equal(events[0].lat, 37.8854536);
  assert.equal(events[0].lon, -122.2753925);
  assert.equal(events[0].url, "https://berkeleypubliclibrary.libnet.info/event/15292079");
  assert.equal(events[0].extractionMethod, "communico-events");
});

test("extractLocalistEvents parses public Stanford Localist events and skips internal campus items", () => {
  const events = extractLocalistEvents(
    {
      events: [
        {
          event: {
            id: 5061,
            title: "Public Tour | Cantor Highlights",
            status: "live",
            private: false,
            localist_url: "https://events.stanford.edu/event/cantor-highlights-tour",
            location_name: "Cantor Arts Center",
            room_number: "Lobby",
            geo: {
              latitude: "37.432981",
              longitude: "-122.170494",
              city: "Stanford",
            },
            free: true,
            description_text: "A public museum tour for families and visitors.",
            event_instances: [
              {
                event_instance: {
                  id: 7001,
                  start: "2026-05-11T13:00:00-07:00",
                  end: "2026-05-11T14:00:00-07:00",
                  all_day: false,
                },
              },
            ],
            filters: {
              event_audience: [{ name: "General Public" }],
              event_subject: [{ name: "Arts/Media" }],
              event_types: [{ name: "Tour" }],
            },
          },
        },
        {
          event: {
            id: 5062,
            title: "Archive Room: Ruth Asawa",
            status: "live",
            private: false,
            localist_url: "https://events.stanford.edu/event/archive-room-ruth-asawa",
            location_name: "Cantor Arts Center",
            geo: {
              latitude: "37.432981",
              longitude: "-122.170494",
              city: "Stanford",
            },
            free: false,
            description_text: "Museum hours. We're always free! Come visit us.",
            event_instances: [
              {
                event_instance: {
                  id: 7002,
                  start: "2026-05-11T00:00:00-07:00",
                  end: null,
                  all_day: true,
                },
              },
            ],
            filters: {
              event_audience: [{ name: "Everyone" }],
              event_subject: [{ name: "Arts/Media" }],
              event_types: [{ name: "Exhibition" }],
            },
          },
        },
        {
          event: {
            id: 5063,
            title: "Public Tour | Papua New Guinea Sculpture Walk",
            status: "live",
            private: false,
            localist_url: "https://events.stanford.edu/event/public_tour_papua_new_guinea_sculpture_walk_1489",
            location_name: "Meet at the Papua New Guinea Sculpture Garden, at the corner of Santa Teresa & Lomita Drive.",
            geo: {
              latitude: "0",
              longitude: "0",
              city: "Stanford",
            },
            free: true,
            description_text: "Created on-site at Stanford by artists from Papua New Guinea. A public museum tour for families and visitors.",
            event_instances: [
              {
                event_instance: {
                  id: 7003,
                  start: "2026-05-24T11:30:00-07:00",
                  end: "2026-05-24T12:30:00-07:00",
                },
              },
            ],
            filters: {
              event_audience: [{ name: "Everyone" }],
              event_subject: [{ name: "Arts/Media" }],
              event_types: [{ name: "Tour" }],
            },
          },
        },
        {
          event: {
            id: 5064,
            title: "Teaching with AI Community Share-outs",
            status: "live",
            private: false,
            localist_url: "https://events.stanford.edu/event/teaching-with-ai",
            location_name: "408 Panama Mall",
            description_text: "Workshop for faculty and staff.",
            event_instances: [
              {
                event_instance: {
                  id: 7004,
                  start: "2026-05-11T15:00:00-07:00",
                  end: "2026-05-11T16:00:00-07:00",
                },
              },
            ],
            filters: {
              event_audience: [{ name: "General Public" }],
              event_subject: [{ name: "Education" }],
              event_types: [{ name: "Workshop" }],
            },
          },
        },
      ],
    },
    {
      id: "stanford-events",
      name: "Stanford Events",
      url: "https://events.stanford.edu/",
      city: "Stanford",
      lat: 37.4275,
      lon: -122.1697,
      sourceType: "localistEvents",
      localistAllowedTypeNames: ["Exhibition", "Tour", "Performance", "Film/Screening", "Social Event/Reception", "Workshop"],
    },
  );

  assert.equal(events.length, 3);
  const tour = events.find((event) => event.title === "Public Tour | Cantor Highlights");
  assert.equal(tour.venue, "Cantor Arts Center - Lobby");
  assert.equal(tour.startDateTime, "2026-05-11T20:00:00.000Z");
  assert.equal(tour.extractionMethod, "localist-events");
  assert.equal(tour.cost, "Free");
  assert.deepEqual(tour.ageBands, ["preschool", "school-age"]);
  const exhibition = events.find((event) => event.title === "Archive Room: Ruth Asawa");
  assert.equal(exhibition.startDateTime, "2026-05-11T17:00:00.000Z");
  assert.equal(exhibition.cost, "Free");
  const sculptureWalk = events.find((event) => event.title === "Public Tour | Papua New Guinea Sculpture Walk");
  assert.equal(sculptureWalk.city, "Stanford");
  assert.equal(sculptureWalk.lat, 37.4275);
  assert.equal(sculptureWalk.lon, -122.1697);
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

test("extractChicagoParkDistrictEvents parses Family Fun cards", () => {
  const html = `
    <div class="node--type-event node--view-mode-card">
      <div class="event--date ">May </br> 17</div>
      <h3 class="event--title">
        <a href="/events/building-fairy-houses-npv">Building Fairy Houses at NPV</a>
      </h3>
      <div class="field-with-icon event--location">North Park Village Nature Center</div>
      <div class="field-with-icon event--duration">1:30 PM - 2:30 PM</div>
    </div>
  `;

  const events = extractChicagoParkDistrictEvents(html, {
    id: "chicago-parks-family",
    name: "Chicago Park District Events",
    url: "https://www.chicagoparkdistrict.com/events?field_event_category_target_id=766",
    city: "Chicago",
    category: "Park",
    lat: 41.8781,
    lon: -87.6298,
    timezoneOffset: "-05:00",
    defaultAudienceText: "children family kids parks outdoors nature recreation",
    cost: "Free",
  }, { now: new Date("2026-05-12T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Building Fairy Houses at NPV");
  assert.equal(events[0].venue, "NPV");
  assert.equal(events[0].startDateTime, "2026-05-17T18:30:00.000Z");
  assert.equal(events[0].url, "https://www.chicagoparkdistrict.com/events/building-fairy-houses-npv");
  assert.equal(events[0].extractionMethod, "chicago-park-district");
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

test("extractHtmlEvents skips calendar chrome titles", () => {
  const html = `
    <article class="event-card">
      <h3><a href="/calendar/2026-05-09">1 event, 9</a></h3>
      <time datetime="2026-05-09T00:00:00-07:00">May 9</time>
      <p>Calendar navigation for family events.</p>
    </article>
    <article class="event-card">
      <h3><a href="/event/family-night">2026-05-09 Family Science Night</a></h3>
      <time datetime="2026-05-09T18:00:00-07:00">May 9</time>
      <p>Hands-on science for kids and families.</p>
    </article>
    <article class="event-card">
      <h3><a href="/event/family-camp">Family Camp Family Camp May 10 @ 5:00 pm</a></h3>
      <time datetime="2026-05-10T17:00:00-07:00">May 10</time>
      <p>Overnight science camp for school-age kids and families.</p>
    </article>
    <article class="event-card">
      <h3><a href="/event/open-daily">OPEN DAILY FROM 10 AM TO 5 PM.</a></h3>
      <time datetime="2026-05-10T10:00:00-07:00">May 10</time>
      <p>General admission hours for family visitors.</p>
    </article>
    <article class="event-card">
      <h3><a href="/event/postponed">Astronaut Visit – Postponed</a></h3>
      <time datetime="2026-05-10T11:00:00-07:00">May 10</time>
      <p>Family science talk.</p>
    </article>
  `;

  const events = extractHtmlEvents(html, source);
  assert.equal(events.length, 2);
  assert.equal(events[0].title, "Family Science Night");
  assert.equal(events[1].title, "Family Camp");
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

test("extractWwcEvents reads Discovery Green widget cards", () => {
  const html = `
    <h6>Saturday Jun 20th</h6>
    <event id="event-10276" class="event-grid-item">
      <a class="event-link-wrapper" href="https://www.discoverygreen.com/event/mini-makers-workshop-9/june-20-2026-1200-pm/">
        <div class="elementor-heading-title elementor-size-default">Saturday Jun 20th</div>
        <div class="elementor-heading-title elementor-size-default">12:00 pm - 2:00 pm</div>
        <h5 class="elementor-heading-title elementor-size-default">Mini Makers Workshop</h5>
        <div class="elementor-widget-theme-post-excerpt">
          <div class="elementor-widget-container">Create soccer crafts with the Discovery Green Ambassadors at Mini Makers Workshop!</div>
        </div>
      </a>
    </event>
  `;

  const events = extractWwcEvents(html, {
    id: "houston-parks-family",
    name: "Discovery Green Family Events",
    url: "https://www.discoverygreen.com/event-category/parks-play/",
    city: "Houston",
    category: "Park",
    timezoneOffset: "-05:00",
    defaultAudienceText: "children family kids parks outdoors nature recreation",
    cost: "Free",
    eventList: {
      venue: "Houston Parks Events",
      requireFamilySignal: false,
      defaultDurationMinutes: 90,
    },
  }, { now: new Date("2026-05-17T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Mini Makers Workshop");
  assert.equal(events[0].startDateTime, "2026-06-20T17:00:00.000Z");
  assert.equal(events[0].endDateTime, "2026-06-20T19:00:00.000Z");
  assert.equal(events[0].extractionMethod, "wwc-events");
});

test("extractWebflowEvents reads Children Museum Houston cards and keeps active ranges", () => {
  const html = `
    <div role="listitem" class="event-calendar-item w-dyn-item">
      <div class="secret-wrapper" style="display:none;">
        <div class="eventType">false</div>
        <div class="dateType">Apr 18, 2026</div>
        <div class="dateType2">Jun 12, 2026</div>
      </div>
      <a href="/events/eastarts-workshop-series-1" class="event-calendar-card w-inline-block">
        <h4 class="h4-name">EastArts Workshop Series 1: Japanese Stencil Dyeing</h4>
        <p class="event-preview">A workshop series that immerses kids in East Asian arts and craft techniques.</p>
      </a>
    </div>
    <div role="listitem" class="calendar-special-events-item w-dyn-item">
      <div class="secret-wrapper-events-header" style="display:none;">
        <div class="dateType">Jun 08, 2026</div>
        <div class="dateType2">Jun 08, 2026</div>
      </div>
      <a href="/events/museum-closed-private-event" class="calendar-special-title w-inline-block">
        <h1>Museum Closed: Private Event!</h1>
      </a>
    </div>
  `;

  const events = extractWebflowEvents(html, {
    id: "houston-museum-family",
    name: "Children's Museum Houston Events",
    url: "https://www.cmhouston.org/events",
    city: "Houston",
    category: "Museum",
    timezoneOffset: "-05:00",
    defaultAudienceText: "children family kids museum science art workshop",
    eventList: {
      venue: "Children's Museum Houston Events",
      requireFamilySignal: false,
      defaultStartTime: "10:00",
      defaultDurationMinutes: 90,
    },
  }, { now: new Date("2026-05-17T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "EastArts Workshop Series 1: Japanese Stencil Dyeing");
  assert.equal(events[0].startDateTime, "2026-05-17T15:00:00.000Z");
  assert.equal(events[0].extractionMethod, "webflow-events");
});

test("extractPhoenixZooEvents reads zoo event cards without picking CTA text", () => {
  const html = `
    <div class="event-inner-container">
      <a href="https://www.phoenixzoo.org/events/member-event-coffee-with-curator/" class="event-img-wrapper"></a>
      <div class="event-content-wrapper">
        <h2 class="h4"><a href="https://www.phoenixzoo.org/events/member-event-coffee-with-curator/"> Member Event: Coffee and Conservation </a></h2>
        <h6>Saturday, May 23</h6>
        <p>Learn how zoo conservation efforts are making an impact for wildlife and families.</p>
        <a class="event-link" href="https://www.phoenixzoo.org/events/member-event-coffee-with-curator/">Info &amp; Tickets</a>
      </div>
    </div>
  `;

  const events = extractPhoenixZooEvents(html, {
    id: "phoenix-zoo-family",
    name: "Phoenix Zoo Events",
    url: "https://www.phoenixzoo.org/events/",
    city: "Phoenix",
    category: "Zoo",
    timezoneOffset: "-07:00",
    defaultAudienceText: "children family kids zoo animals aquarium nature",
    eventList: {
      venue: "Phoenix Zoo Events",
      requireFamilySignal: false,
      defaultStartTime: "10:00",
      defaultDurationMinutes: 90,
    },
  }, { now: new Date("2026-05-17T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Member Event: Coffee and Conservation");
  assert.equal(events[0].startDateTime, "2026-05-23T17:00:00.000Z");
  assert.equal(events[0].url, "https://www.phoenixzoo.org/events/member-event-coffee-with-curator/");
  assert.equal(events[0].extractionMethod, "phoenix-zoo-events");
});

test("extractZooAtlantaEvents expands multi-date zoo cards and rejects adults-only cards", () => {
  const html = `
    <div class="event card">
      <div class="front-content">
        <h3 role="heading" aria-level="3">Grossology Day</h3>
        <em>July 12</em>
      </div>
      <div class="back-content">
        <p>July 12</p>
        <p>Explore animal science activities for kids and families.</p>
      </div>
      <a role="button" class="read-more" href="https://zooatlanta.org/event/grossology-day/">Learn More</a>
    </div>
    <div class="event card">
      <div class="front-content">
        <h3 role="heading" aria-level="3">Boo at the Zoo</h3>
        <em>October 17, 18, 24, 25 &amp; 31</em>
      </div>
      <div class="back-content">
        <p>October 17, 18, 24, 25 &amp; 31</p>
        <p>Trick-or-treating and family-friendly Halloween activities.</p>
      </div>
      <a role="button" class="read-more" href="https://zooatlanta.org/event/boo-at-the-zoo/">Learn More</a>
    </div>
    <div class="event card">
      <div class="front-content">
        <h3 role="heading" aria-level="3">Pride Night</h3>
        <em>June 12</em>
      </div>
      <div class="back-content">
        <p>June 12</p>
        <p>A 21+ evening with wine and beer.</p>
      </div>
    </div>
  `;

  const events = extractZooAtlantaEvents(html, {
    id: "atlanta-zoo-family",
    name: "Zoo Atlanta Events",
    url: "https://zooatlanta.org/visit/events/",
    city: "Atlanta",
    category: "Zoo",
    timezoneOffset: "-04:00",
    defaultAudienceText: "children family kids zoo animals aquarium nature",
    eventList: {
      venue: "Zoo Atlanta Events",
      requireFamilySignal: false,
      excludePattern: "pride night|21\\+|wine|beer",
      defaultStartTime: "10:00",
      defaultDurationMinutes: 90,
    },
  }, { now: new Date("2026-05-17T12:00:00Z") });

  assert.equal(events.length, 6);
  assert.equal(events[0].title, "Grossology Day");
  assert.equal(events[0].description, "Explore animal science activities for kids and families.");
  assert.equal(events[0].startDateTime, "2026-07-12T14:00:00.000Z");
  assert.equal(events[1].title, "Boo at the Zoo");
  assert.equal(events[1].startDateTime, "2026-10-17T14:00:00.000Z");
  assert.equal(events[5].startDateTime, "2026-10-31T14:00:00.000Z");
  assert.equal(events[0].extractionMethod, "zoo-atlanta-events");
});

test("extractEventOnEvents reads EventON JSON and applies source excludes", () => {
  const keptStart = 1777657200;
  const events = extractEventOnEvents({
    status: "GOOD",
    json: [
      {
        event_id: 31368,
        event_start_unix: keptStart,
        event_end_unix: keptStart + 3600,
        event_title: "Japan Art Hour!",
        event_pmv: {
          evcal_subtitle: ["Hands-on art workshop for kids ages 3 to 6."],
        },
      },
      {
        event_id: 29710,
        event_start_unix: keptStart + 7200,
        event_end_unix: keptStart + 9000,
        event_title: "Boston Children's Museum Opens at 10am Due to Morningstar Access (Registration Only)",
        event_pmv: {},
      },
    ],
  }, {
    id: "boston-museum-family",
    name: "Boston Children's Museum Calendar",
    url: "https://bostonchildrensmuseum.org/Calendar/",
    city: "Boston",
    category: "Museum",
    defaultAudienceText: "children family kids museum science art workshop",
    eventList: {
      venue: "Boston Children's Museum Events",
      requireFamilySignal: false,
      excludePattern: "opens? at|morningstar access|registration only",
    },
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Japan Art Hour!");
  assert.equal(events[0].startDateTime, new Date(keptStart * 1000).toISOString());
  assert.equal(events[0].description, "Hands-on art workshop for kids ages 3 to 6.");
  assert.equal(events[0].extractionMethod, "eventon-events");
});

test("extractBrooklynLibraryEvents reads youth and family library cards", () => {
  const html = `
    <div class="d-flex my-4 event-item">
      <div class="flex-grow-1 event-content">
        <a href="/calendar/stomp-clap-and-sing-central-library-dweck-20260519-1030am">
          <h4 class="card-title">Stomp, Clap and Sing with Amelia Robinson of Mil&#039;s Trills</h4>
        </a>
        <div class="meta my-2">
          <div class="date"><i class="fa-regular fa-calendar icon"></i> Tue, May 19 10:30am</div>
          <div class="location"><i class="fa-solid fa-location-dot icon"></i> Central Library, Dweck Center</div>
        </div>
        <p class="tags mb-3">
          <a>Events for Youth and Family</a> <a>kids</a> <a>music</a>
        </p>
        <p>Special acoustic performance featuring nursery rhymes and interactive songs.</p>
      </div>
    </div>
  `;

  const events = extractBrooklynLibraryEvents(html, {
    id: "brooklyn-library-youth-family",
    name: "Brooklyn Public Library - Youth and Family",
    url: "https://www.bklynlibrary.org/event-series/events-for-youth-and-family",
    city: "Brooklyn",
    category: "Library",
    timezoneOffset: "-04:00",
    defaultAudienceText: "children family kids",
    eventList: {
      venue: "Brooklyn Public Library",
      city: "Brooklyn",
      requireFamilySignal: false,
      defaultDurationMinutes: 90,
    },
  }, { now: new Date("2026-05-17T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Stomp, Clap and Sing with Amelia Robinson of Mil's Trills");
  assert.equal(events[0].startDateTime, "2026-05-19T14:30:00.000Z");
  assert.equal(events[0].venue, "Central Library, Dweck Center");
  assert.equal(events[0].extractionMethod, "brooklyn-library-events");
});

test("extractTicketureEvents reads dated ticketing templates and rejects adult events", () => {
  const events = extractTicketureEvents({
    event_template: {
      _data: [
        {
          id: "perot-family",
          name: "Member After Hours: Soccer Night",
          category: "Events",
          summary: "<b>June 5, 2026, 5:30-9pm</b><br>Enjoy family-friendly STEM activities.",
          venue_id: "perot-venue",
        },
        {
          id: "perot-adult",
          name: "Thursdays on Tap",
          category: "Events",
          summary: "Ages 21+ evening with cocktails and adult beverages.",
          venue_id: "perot-venue",
        },
      ],
    },
    venue: {
      _data: [
        { id: "perot-venue", name: "Perot Museum of Nature and Science" },
      ],
    },
    calendars: {
      "perot-family": {
        calendar: {
          _data: [{ date: "2026-06-05", status: "available" }],
        },
      },
    },
  }, {
    id: "dallas-fort-worth-museum-family",
    name: "Perot Museum Events",
    url: "https://www.perotmuseum.org/events/",
    ticketureBaseUrl: "https://ticketing.perotmuseum.org/",
    city: "Dallas",
    category: "Museum",
    timezoneOffset: "-05:00",
    defaultAudienceText: "children family kids museum science art workshop",
    eventList: {
      venue: "Perot Museum Events",
      city: "Dallas",
      requireFamilySignal: false,
      excludePattern: "thursdays on tap|21\\+|adult beverages|cocktails",
      defaultDurationMinutes: 90,
    },
  }, { now: new Date("2026-05-17T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Member After Hours: Soccer Night");
  assert.equal(events[0].startDateTime, "2026-06-05T22:30:00.000Z");
  assert.equal(events[0].endDateTime, "2026-06-06T02:00:00.000Z");
  assert.equal(events[0].venue, "Perot Museum of Nature and Science");
  assert.equal(events[0].extractionMethod, "ticketure-events");
});

test("extractWpRestEvents reads single-date ACF event fields", () => {
  const events = extractWpRestEvents([
    {
      id: 71482,
      title: { rendered: "Valentine&#8217;s Day Cupcake Decorating" },
      link: "https://www.philadelphiazoo.org/events/valentines-day-cupcake-decorating/",
      start_time: "10:00:00",
      end_time: "14:00:00",
      acf: {
        event_date: "20260214",
        card_description: "Decorate cupcakes at a family-friendly zoo event for kids.",
      },
    },
  ], {
    id: "philadelphia-zoo-family",
    name: "Philadelphia Zoo Events",
    url: "https://www.philadelphiazoo.org/events/",
    city: "Philadelphia",
    category: "Zoo",
    timezoneOffset: "-05:00",
    defaultAudienceText: "children family kids zoo animals aquarium nature",
  });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Valentine\u2019s Day Cupcake Decorating");
  assert.equal(events[0].startDateTime, "2026-02-14T15:00:00.000Z");
  assert.equal(events[0].endDateTime, "2026-02-14T19:00:00.000Z");
  assert.equal(events[0].extractionMethod, "wp-rest-events");
});

test("extractMidpenTableEvents reads guided open-space rows and filters unsuitable rows", () => {
  const html = `
    <table>
      <tr>
        <td class="views-field views-field-type-guided-activity"><div>Guided Activity</div></td>
        <td class="views-field views-field-title"><a href="/events/guided-activities/butterflies-picchetti-ranch">Butterflies of Picchetti Ranch</a></td>
        <td class="views-field views-field-aggregated-dates"><div class="activity-search-date">Saturday, May 09, 2026</div><div class="activity-search-time">10:00 am</div></td>
        <td class="views-field views-field-field-activity-type"><div class="icon-link__name sr-only">Hike</div></td>
        <td class="views-field views-field-field-preserve-term-1">Picchetti Ranch Preserve</td>
        <td class="views-field views-field-field-aprox-total-miles">3</td>
      </tr>
      <tr>
        <td class="views-field views-field-type-volunteer-project"><div>Volunteer Project</div></td>
        <td class="views-field views-field-title"><a href="/events/volunteer-projects/habitat-restoration">Habitat Restoration</a></td>
        <td class="views-field views-field-aggregated-dates"><div class="activity-search-date">Saturday, May 09, 2026</div><div class="activity-search-time">9:30 a.m.</div></td>
        <td class="views-field views-field-field-preserve-term-1">Rancho San Antonio Preserve</td>
      </tr>
      <tr>
        <td class="views-field views-field-type-guided-activity"><div>Guided Activity</div></td>
        <td class="views-field views-field-title"><a href="/events/guided-activities/long-hike">Long Hike</a></td>
        <td class="views-field views-field-aggregated-dates"><div class="activity-search-date">Sunday, May 10, 2026</div><div class="activity-search-time">9:00 a.m.</div></td>
        <td class="views-field views-field-field-activity-type"><div class="icon-link__name sr-only">Hike</div></td>
        <td class="views-field views-field-field-preserve-term-1">Russian Ridge Preserve</td>
        <td class="views-field views-field-field-aprox-total-miles">7</td>
      </tr>
    </table>
  `;

  const events = extractMidpenTableEvents(html, {
    id: "midpen-open-space",
    name: "Midpeninsula Regional Open Space District",
    url: "https://www.openspace.org/get-involved/events-activities",
    city: "Los Altos",
    category: "Park",
    sourceType: "midpenTable",
    defaultAudienceText: "family kids school-age tween nature guided hike",
    maxFamilyMiles: 4.5,
  }, { now: new Date("2026-05-05T12:00:00Z") });

  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Butterflies of Picchetti Ranch");
  assert.equal(events[0].venue, "Picchetti Ranch Preserve");
  assert.equal(events[0].extractionMethod, "midpen-table");
  assert.equal(events[0].startDateTime, "2026-05-09T17:00:00.000Z");
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

  dataset.events[0].city = "Daly City";
  assert.equal(
    validateEventsDataset(dataset, {
      minEvents: 1,
      cities: ["San Francisco"],
      bbox: { south: 37.7, west: -122.5, north: 37.9, east: -122.3 },
    }).length,
    0,
  );
  assert.match(
    validateEventsDataset(dataset, {
      minEvents: 1,
      cities: ["San Francisco"],
      bbox: { south: 38.0, west: -122.5, north: 38.2, east: -122.3 },
    })[0],
    /outside configured coverage/,
  );
  dataset.events[0].city = "San Francisco";

  dataset.events[0].lat = 0;
  dataset.events[0].lon = 0;
  assert.match(validateEventsDataset(dataset, { minEvents: 1 })[0], /null island/);
  dataset.events[0].lat = 37.8;
  dataset.events[0].lon = -122.4;

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
