import { describe, expect, it } from "vitest";
import {
  pickProfileEvents,
  renderWeekendDigest,
  type DigestEvent,
} from "../worker/src/newsletter-template";

// Pin "now" to a Wednesday so the upcoming weekend is Sat May 23 + Sun May 24
// in America/New_York (mirrors newsletterTemplate.test.ts).
const NOW = new Date("2026-05-20T15:00:00-04:00");

const events: DigestEvent[] = [
  {
    id: "toddler-story",
    title: "Toddler storytime",
    venue: "Decatur Library",
    startDateTime: "2026-05-23T13:00:00.000Z",
    ageBands: ["toddler", "preschool"],
    themes: ["story-time"],
    cost: "Free",
  },
  {
    id: "stem-lab",
    title: "Saturday STEM lab",
    venue: "Children's Museum",
    startDateTime: "2026-05-23T16:00:00.000Z",
    ageBands: ["school-age", "tween"],
    themes: ["stem"],
    cost: "$",
  },
  {
    id: "tween-karaoke",
    title: "Tween karaoke night",
    venue: "Rec Center",
    startDateTime: "2026-05-23T19:00:00.000Z",
    ageBands: ["tween"],
    themes: ["music-performance"],
    cost: "$",
  },
  {
    id: "big-festival",
    title: "City festival parade",
    venue: "Downtown",
    startDateTime: "2026-05-24T15:00:00.000Z",
    ageBands: [],
    themes: ["festivals-community"],
    cost: "Free",
  },
  {
    // Raw interestingness is high enough to clear the headliner gate, but the
    // fireworks one below scores higher generically — only a toddler profile
    // boost can put this event at the top.
    id: "dino-parade",
    title: "Toddler dinosaur parade",
    venue: "Playground",
    startDateTime: "2026-05-23T13:00:00.000Z",
    ageBands: ["toddler", "preschool"],
    themes: ["festivals-community"],
    cost: "Free",
  },
  {
    id: "big-fireworks",
    title: "Big fireworks festival",
    venue: "Waterfront",
    startDateTime: "2026-05-23T20:00:00.000Z",
    ageBands: ["tween"],
    themes: ["music-performance"],
    cost: "Free",
  },
  {
    id: "off-window",
    title: "Next week science show",
    venue: "Museum",
    startDateTime: "2026-05-30T16:00:00.000Z",
    ageBands: ["school-age"],
    themes: ["stem"],
    cost: "Free",
  },
];

const weekend = {
  saturdayKey: "2026-05-23",
  sundayKey: "2026-05-24",
  label: "May 23–24",
  timezone: "America/New_York",
};

describe("pickProfileEvents", () => {
  it("ranks age-band matches above generic interestingness", () => {
    // The toddler-marked dino parade (raw 10) beats every non-toddler event
    // once the age boost lands, including the raw-equal festival.
    const picked = pickProfileEvents(events, weekend, 5, NOW, {
      ageBands: ["toddler"],
    });
    expect(picked[0].id).toBe("dino-parade");
  });

  it("boosts interest-theme overlap", () => {
    const picked = pickProfileEvents(events, weekend, 3, NOW, {
      ageBands: ["school-age", "tween"],
      interests: ["stem", "music-performance"],
    });
    expect(picked.map((e) => e.id)).toEqual([
      "big-fireworks",
      "stem-lab",
      "tween-karaoke",
    ]);
  });

  it("boosts free events for a free-budget profile", () => {
    const picked = pickProfileEvents(events, weekend, 3, NOW, {
      budget: "free",
    });
    // Free events outrank ticketed ones of equal interestingness.
    expect(picked[0].cost).toBe("Free");
  });

  it("never includes off-window events", () => {
    const picked = pickProfileEvents(events, weekend, 10, NOW, {
      ageBands: ["school-age"],
    });
    expect(picked.some((e) => e.id === "off-window")).toBe(false);
  });

  it("ranks unknown-age events above explicit mismatches", () => {
    const picked = pickProfileEvents(events, weekend, 5, NOW, {
      ageBands: ["toddler"],
    });
    // Unknown-age festival stays in the top 5; the tween-only karaoke falls
    // out of the list entirely for a toddler profile.
    expect(picked.some((e) => e.id === "big-festival")).toBe(true);
    expect(picked.some((e) => e.id === "tween-karaoke")).toBe(false);
  });
});

describe("renderWeekendDigest with profile", () => {
  it("leads the subject with the profile-ranked headliner (raw gate still holds)", () => {
    const digest = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans: [],
      events,
      now: NOW,
      // Tween + music boost lifts the fireworks (raw 7, above the 4-point
      // headliner gate) over the raw-stronger dino parade (raw 10).
      profile: { ageBands: ["tween"], interests: ["music-performance"] },
    });
    expect(digest.subject).toContain("Big fireworks festival");
  });

  it("degrades to the generic digest without a profile", () => {
    const digest = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans: [],
      events,
      now: NOW,
    });
    // No profile → the highest raw-scoring marquee event headlines.
    expect(digest.subject).toContain("Toddler dinosaur parade");
  });

  it("never headlines routine programming even when profiled (editorial contract)", () => {
    const digest = renderWeekendDigest({
      metroId: "atlanta",
      metroLabel: "Atlanta",
      timezone: "America/New_York",
      plans: [],
      events: [events[0]], // toddler-storytime only
      now: NOW,
      profile: { ageBands: ["toddler"] },
    });
    expect(digest.subject).not.toContain("Toddler storytime");
  });
});
