// Interest-theme classifier for family events (ROADMAP: themed weekend summary).
//
// The raw `category` field is venue-type (Library, Museum, Park…) and heavily
// skewed, so it's useless for an interest-driven browse. This maps each event
// to zero or more *interest themes* by keyword-matching its category + title +
// description. Rule-based and deterministic so it can run at ingest; both the
// React app and the SEO generator read the resulting `themes[]` off each event.
//
// An event can match multiple themes. Order in THEMES is the display priority.

/**
 * @typedef {Object} Theme
 * @property {string} id        Stable id stored in event.themes.
 * @property {string} label     Human-facing section title.
 * @property {string} blurb     One-line section description.
 * @property {RegExp} pattern   Matched against `${category} ${title} ${description}`.
 */

/** @type {Theme[]} */
export const THEMES = [
  // Patterns use word-start stems (leading `\b`, no trailing boundary) so
  // morphological variants are caught: `music` → musical/musician, `bird` →
  // birding, `paint` → painting. Keep stems specific enough to avoid false
  // hits (e.g. `stor(y|ies)` rather than bare `stor`).
  {
    id: "story-time",
    label: "Story time & books",
    blurb: "Read-alouds, story hours, rhyme times, author visits, and book clubs.",
    pattern:
      /\b(stor(y|ies)|storytime|read[\s-]?aloud|reading|author|book ?club|books?|picture book|rhyme|lapsit|bounce and rhyme|mother goose|circle time|literacy)\b/i,
  },
  {
    id: "stem",
    label: "STEM & hands-on",
    blurb: "Science, coding, robotics, building, and other hands-on, curious-kid programs.",
    pattern:
      /\b(stem|steam|scien|coding|code|robot|lego|maker|engineer|experiment|technolog|3d ?print|circuit|\bmath|astronom|planetarium|chemistr|biolog)\b/i,
  },
  {
    id: "arts-crafts",
    label: "Arts & crafts",
    blurb: "Drop-in making, painting, drawing, and creative studio time.",
    pattern:
      /\b(arts?|crafts?|paint|draw|pottery|ceramic|clay|collage|origami|sculpt|creativ|sketch|coloring|craftern)\b/i,
  },
  {
    id: "music-performance",
    label: "Music & performance",
    blurb: "Concerts, recitals, dance, theater, sing-alongs, and live shows.",
    pattern:
      /\b(music|concert|recital|sing|song|choir|orchestra|\bband\b|danc|ballet|theat(er|re)|performance|opera|carillon|jazz|drum|puppet|magic show|jamboree)\b/i,
  },
  {
    id: "animals-nature",
    label: "Animals & nature",
    blurb: "Zoos, farms, gardens, and wildlife walks to get up close with the outdoors.",
    pattern:
      /\b(zoo|animal|farm|nature|wildlife|garden|botanic|aquarium|bird|insect|butterfl|petting|hike|hiking|trail|ranger|tide ?pool|creek|forest|penguin|feeding)\b/i,
  },
  {
    id: "active-outdoors",
    label: "Active & outdoors",
    blurb: "Sports, playgrounds, swimming, biking, and run-around energy burners.",
    pattern:
      /\b(sport|soccer|basketball|baseball|tennis|swim|\bpool|bike|cycling|climb|race|playground|play ?date|playtime|play ?cafe|stay (and|&) play|open play|sensory|tumbl|gymnastic|\bgym\b|yoga|skate|martial|obstacle|field day)\b/i,
  },
  {
    id: "food-markets",
    label: "Food & markets",
    blurb: "Farmers markets, food trucks, tastings, and cooking fun.",
    pattern:
      /\b(market|farmers ?market|\bfood|cooking|cook|bake|baking|taste|tasting|culinary|night market|food truck|harvest|pumpkin patch)\b/i,
  },
  {
    id: "festivals-community",
    label: "Festivals & community",
    blurb: "Fairs, parades, seasonal celebrations, and big community gatherings.",
    pattern:
      /\b(festival|\bfair\b|parade|celebrat|carnival|fiesta|holiday|lunar new year|diwali|lantern|block party|cultural celebration)\b/i,
  },
];

const THEME_IDS = new Set(THEMES.map((t) => t.id));

/**
 * Classify one event into interest themes.
 * @param {{category?: string, title?: string, description?: string}} event
 * @returns {string[]} matched theme ids, in THEMES display order (may be empty).
 */
export function classifyEventThemes(event) {
  const haystack = `${event.category || ""} ${event.title || ""} ${event.description || ""}`;
  const ids = [];
  for (const theme of THEMES) {
    if (theme.pattern.test(haystack)) ids.push(theme.id);
  }
  return ids;
}

/** @param {string} id */
export function isKnownTheme(id) {
  return THEME_IDS.has(id);
}
