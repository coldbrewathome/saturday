// Display metadata for interest themes (id → label/blurb), used by the app to
// render the "Browse by interest" filter. The classification logic + the
// canonical taxonomy live in scripts/eventThemes.mjs (run at ingest); the app
// can't import that .mjs under `allowJs: false`, so this mirrors only the
// presentational fields. Keep the ids + order in sync with eventThemes.mjs.

export type EventTheme = {
  id: string;
  label: string;
  blurb: string;
};

export const EVENT_THEMES: EventTheme[] = [
  {
    id: "story-time",
    label: "Story time & books",
    blurb: "Read-alouds, story hours, rhyme times, author visits, and book clubs.",
  },
  {
    id: "stem",
    label: "STEM & hands-on",
    blurb: "Science, coding, robotics, building, and other hands-on programs.",
  },
  {
    id: "arts-crafts",
    label: "Arts & crafts",
    blurb: "Drop-in making, painting, drawing, and creative studio time.",
  },
  {
    id: "music-performance",
    label: "Music & performance",
    blurb: "Concerts, recitals, dance, theater, sing-alongs, and live shows.",
  },
  {
    id: "animals-nature",
    label: "Animals & nature",
    blurb: "Zoos, farms, gardens, and wildlife walks in the outdoors.",
  },
  {
    id: "active-outdoors",
    label: "Active & outdoors",
    blurb: "Sports, playgrounds, swimming, biking, and energy burners.",
  },
  {
    id: "food-markets",
    label: "Food & markets",
    blurb: "Farmers markets, food trucks, tastings, and cooking fun.",
  },
  {
    id: "festivals-community",
    label: "Festivals & community",
    blurb: "Fairs, parades, seasonal celebrations, and big gatherings.",
  },
];

export const EVENT_THEME_LABELS: Record<string, string> = Object.fromEntries(
  EVENT_THEMES.map((t) => [t.id, t.label]),
);
