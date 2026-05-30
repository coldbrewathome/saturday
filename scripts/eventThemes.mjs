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
  // Each pattern is a leading `\b` + word-start stems with NO trailing
  // boundary on the group, so morphological variants match: `music` →
  // musical/musician, `bird` → birding, `paint` → painting. Short stems that
  // would over-match (zoo→"zoom", sing→"single", fair→"fairy") carry their
  // own explicit `\b`.
  {
    id: "story-time",
    label: "Story time & books",
    blurb: "Read-alouds, story hours, rhyme times, author visits, and book clubs.",
    pattern:
      /\b(stor(y|ies|ytime)|read[\s-]?aloud|reading|author|book ?clubs?|books?|picture ?book|rhyme|lapsit|mother goose|circle time|literacy)/i,
  },
  {
    id: "stem",
    label: "STEM & hands-on",
    blurb: "Science, coding, robotics, building, and other hands-on, curious-kid programs.",
    pattern:
      /\b(stem\b|steam\b|scien|cod(e|ing)|robot|lego|maker|engineer|experiment|technolog|3d ?print|circuit|math|astronom|planetarium|chem(istry|ical)|biolog)/i,
  },
  {
    id: "arts-crafts",
    label: "Arts & crafts",
    blurb: "Drop-in making, painting, drawing, and creative studio time.",
    pattern:
      /\b(arts?|crafts?|paint|draw(ing)?|pottery|ceramic|clay|collage|origami|sculpt|creativ|sketch|coloring)/i,
  },
  {
    id: "music-performance",
    label: "Music & performance",
    blurb: "Concerts, recitals, dance, theater, sing-alongs, and live shows.",
    pattern:
      /\b(music|concert|recital|sing(ing|along|-along| along)?\b|songs?\b|choir|orchestra|band\b|danc(e|ing)|ballet|theat(er|re)|performance|opera|carillon|jazz|drum|puppet|magic show|jamboree)/i,
  },
  {
    id: "animals-nature",
    label: "Animals & nature",
    blurb: "Zoos, farms, gardens, and wildlife walks to get up close with the outdoors.",
    pattern:
      /\b(zoos?\b|animal|farm|nature|wildlife|garden|botanic|aquarium|bird|insect|butterfl|petting|hik(e|ing)|trail|ranger|tide ?pool|creek|forest|penguin|feeding)/i,
  },
  {
    id: "active-outdoors",
    label: "Active & outdoors",
    blurb: "Sports, playgrounds, swimming, biking, and run-around energy burners.",
    pattern:
      /\b(sport|soccer|basketball|baseball|tennis|swim|pool|bik(e|ing)|cycling|climb|race|playground|play ?date|playtime|play ?cafe|stay (and|&) play|open play|sensory|tumbl|gymnastic|gym\b|yoga|skate|martial|obstacle|field day)/i,
  },
  {
    id: "food-markets",
    label: "Food & markets",
    blurb: "Farmers markets, food trucks, tastings, and cooking fun.",
    pattern:
      /\b(markets?\b|farmers ?market|food|cook(ing)?|bak(e|ing|ery)|taste|tasting|culinary|food ?truck|harvest|pumpkin patch)/i,
  },
  {
    id: "festivals-community",
    label: "Festivals & community",
    blurb: "Fairs, parades, seasonal celebrations, and big community gatherings.",
    pattern:
      /\b(festival|fairs?\b|parade|celebrat|carnival|fiesta|holiday|lunar new year|diwali|lantern|block party|cultural celebration)/i,
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
