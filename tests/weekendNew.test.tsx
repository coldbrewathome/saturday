import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WeekendView from "../src/WeekendView";
import type { FamilyEvent } from "../src/App";
import type { MetroConfig } from "../src/metros";
import type { PopularEventsDataset } from "../src/popularEvents";

afterEach(cleanup);

const metro: MetroConfig = {
  id: "bay-area",
  label: "Bay Area",
  seoName: "Bay Area",
  canonicalPath: "/bay-area/",
  aliases: [],
  dataDir: "bay-area",
  center: { lat: 37.7749, lon: -122.4194 },
  timezone: "America/Los_Angeles",
};

// Same upcomingWeekend math as the view and the popular-section tests.
function upcomingWeekend() {
  const now = new Date();
  const dow = now.getDay();
  const daysToSat = dow === 0 ? -1 : 6 - dow;
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  sat.setDate(now.getDate() + daysToSat);
  return sat;
}
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

const SAT = upcomingWeekend();
const SUN = new Date(SAT);
SUN.setDate(SAT.getDate() + 1);

// fetchedAt after LAST_VISIT — always "new" regardless of the run date.
const LAST_VISIT = "2020-01-01T00:00:00Z";

function makeEvent(id: string, day: Date, hour = 15, overrides: Partial<FamilyEvent> = {}): FamilyEvent {
  return {
    id,
    title: `Event ${id}`,
    description: "",
    venue: "Main Library",
    city: "San Francisco",
    neighborhood: "Civic Center",
    lat: 37.78,
    lon: -122.41,
    category: "Family",
    daysOfWeek: [6],
    timeWindow: "Afternoon",
    ageBands: [],
    cost: "Free",
    url: "https://example.org/storytime",
    verified: true,
    startDateTime: `${key(day)}T${String(hour).padStart(2, "0")}:00:00`,
    fetchedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  } as FamilyEvent;
}

const baseProps = {
  events: [] as FamilyEvent[],
  metro,
  ageBand: "any" as const,
  onAgeBand: () => {},
  savedEventIds: [] as string[],
  onToggleSaved: () => {},
  planEventIds: [] as string[],
  onAddToPlan: () => {},
  onShare: () => {},
  featuredPlans: [],
  onUsePlan: () => {},
  onOpenMap: () => {},
  guideHref: "/bay-area/this-weekend/",
};

function dataset(picks: PopularEventsDataset["picks"]): PopularEventsDataset {
  return {
    schemaVersion: 1,
    metroId: "bay-area",
    audience: "kids",
    weekendStart: key(SAT),
    weekendEnd: key(SUN),
    picks,
  };
}

describe("WeekendView new-since-last-visit chips", () => {
  it("tags the headliner as NEW when an event was added after the last visit", () => {
    render(
      <WeekendView
        {...baseProps}
        events={[makeEvent("a", SUN, 15)]}
        lastVisit={LAST_VISIT}
      />,
    );
    // Single event → it is the headliner, and its NEW chip lives there.
    const headliner = screen.getByLabelText("The one to plan around");
    expect(headliner.textContent).toContain("Event a");
    expect(headliner.querySelectorAll(".weekend-chip-new").length).toBe(1);
  });

  it("shows no NEW chip on a first visit (no lastVisit prop)", () => {
    render(<WeekendView {...baseProps} events={[makeEvent("a", SUN)]} />);
    expect(document.querySelectorAll(".weekend-chip-new").length).toBe(0);
  });

  it("shows no NEW chip when nothing was added after the last visit", () => {
    render(
      <WeekendView
        {...baseProps}
        events={[makeEvent("a", SUN, 15, { fetchedAt: "2019-01-01T00:00:00Z" })]}
        lastVisit={LAST_VISIT}
      />,
    );
    expect(document.querySelectorAll(".weekend-chip-new").length).toBe(0);
  });

  it("shows nothing when the only new event starts next weekend", () => {
    const nextSat = new Date(SAT);
    nextSat.setDate(SAT.getDate() + 7);
    render(
      <WeekendView
        {...baseProps}
        events={[makeEvent("next", nextSat, 15)]}
        lastVisit={LAST_VISIT}
      />,
    );
    expect(screen.queryByLabelText("The one to plan around")).not.toBeInTheDocument();
    expect(document.querySelectorAll(".weekend-chip-new").length).toBe(0);
  });

  it("shows exactly one NEW chip when the event also appears in the best-of and day lists", () => {
    render(
      <WeekendView
        {...baseProps}
        events={[
          makeEvent("a", SUN, 17),
          // Not new (fetched before the last visit) — only "a" carries NEW.
          // Sunday hours keep both events upcoming on any run day.
          makeEvent("b", SUN, 18, { fetchedAt: "2019-01-01T00:00:00Z" }),
        ]}
        lastVisit={LAST_VISIT}
        popularPicks={dataset([
          { eventId: "a", rank: 1 },
          { eventId: "b", rank: 2 },
        ])}
      />,
    );
    // a = headliner (NEW chip), b = best-of (no NEW chip), both repeat in the
    // day lists (no NEW chips there either).
    expect(document.querySelectorAll(".weekend-chip-new").length).toBe(1);
    const bestOf = screen.getByLabelText("Best of the weekend");
    expect(bestOf.querySelectorAll(".weekend-chip-new").length).toBe(0);
  });

  it("ranks marquee titles above routine titles among new events", () => {
    render(
      <WeekendView
        {...baseProps}
        events={[
          makeEvent("routine", SUN, 18, { title: "Toddler Storytime Hour" }),
          makeEvent("marquee", SUN, 19, { title: "Bay Kids Festival" }),
        ]}
        lastVisit={LAST_VISIT}
      />,
    );
    // Both are new; the marquee one-off leads as the headliner, the routine
    // storytime drops to the best-of list.
    const headliner = screen.getByLabelText("The one to plan around");
    expect(headliner.textContent).toContain("Bay Kids Festival");
    expect(headliner.textContent).not.toContain("Toddler Storytime Hour");
    const bestOf = screen.getByLabelText("Best of the weekend");
    expect(bestOf.textContent).toContain("Toddler Storytime Hour");
  });
});
