# Event Search Patterns

Use these patterns to find official local event sources quickly. Replace bracketed terms with event names, dates, cities, venues, organizers, and metro names.

## Core Query Ladder

Start narrow:

```text
"[exact event name]" "[city]" "[year]"
"[exact event name]" "[date]" "[city]"
"[exact event name]" "[venue]" official
```

If that fails, search likely owners:

```text
"[event name]" "[organizer]" "[year]"
"[event name]" "[venue]" tickets
"[event name]" "[city]" calendar
"[event name]" "[city]" parks recreation
"[event name]" "[city]" library
```

Then search government, venue, and infrastructure pages:

```text
site:[city-domain].gov "[event name]" "[year]"
site:[city-domain].gov "[event keyword]" "[date]"
site:sfmta.com "[event name]" "[year]"
site:511.org "[event name]" "[year]"
site:activecommunities.com "[event name]" "[city]"
site:libnet.info "[event name]" "[city]"
site:eventbrite.com "[event name]" "[organizer]"
```

Use broad sweeps only to generate leads:

```text
"[city]" "festival" "[month] [year]" "official"
"[metro]" "weekend events" "[date range]" "official"
"[neighborhood]" "street festival" "[year]"
```

## Source Hierarchy

1. Organizer, venue, city, parks district, library, museum, official event page.
2. Ticketing or registration page controlled by the organizer.
3. Transit/street-closure/government advisory that confirms public festival facts.
4. Tourism bureau or chamber page that links to the organizer.
5. Third-party roundup or blog, only as a lead unless explicitly accepted.

## Query Tactics

- Quote distinctive titles: `"Grillin' in the Mo"`, `"Community Day" "Posy Parade"`.
- Try punctuation variants: apostrophes, ampersands, `and`, accented characters, old and new festival names.
- Include neighborhood names for San Francisco events: `Fillmore`, `North Beach`, `Marina`, `Fisherman's Wharf`, `Presidio`.
- Include venue addresses when the event name is generic.
- Search PDFs for city agendas, flyers, and activity guides when web pages are sparse: `filetype:pdf "[event name]" "[year]"`.
- Search transit advisories for street fairs and parades; they often confirm dates, times, and route closures.
- Search event platform URLs only after identifying the organizer; Eventbrite pages can be primary when created by the organizer.

## Verification Checklist

Before editing source data, capture these facts from the official page:

- Title or unmistakable event name.
- Date and start time; end time if available.
- Venue or route, city, and neighborhood.
- Cost or registration requirement, if stated.
- Audience fit: family/all ages/adults when stated or obvious from official copy.
- Source ownership and URL stability.

If any required fact is missing, keep the item in a follow-up list instead of guessing.

## Modeling Hints

- For one-off pages, use `officialTextEvents` with regex gates for date/time/location text.
- For multi-day events with different hours, create one event per day.
- For recurring museum or aviation programs, add upcoming instances only if the source page enumerates dates.
- For generated feeds with a moving planning window, an event may be verified but filtered out after its `endDateTime`.
