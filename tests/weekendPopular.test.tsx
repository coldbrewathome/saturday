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

// Same upcomingWeekend math as the view — the dataset must name the weekend
// the feed is currently showing for the picks to apply.
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
    // Afternoon of the current weekend — always upcoming regardless of the
    // run time (a Saturday-morning fixture is already past when the suite
    // runs on a Sunday).
    startDateTime: `${key(day)}T${String(hour).padStart(2, "0")}:00:00`,
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

describe("WeekendView popular picks in the briefing", () => {
  it("makes the rank-1 pick the headliner and ranks the rest in the best-of", () => {
    const events = [makeEvent("b", SUN, 15), makeEvent("a", SUN, 16)];
    render(
      <WeekendView
        {...baseProps}
        events={events}
        popularPicks={dataset([
          { eventId: "a", rank: 1, reason: "headliner" },
          { eventId: "b", rank: 2, reason: "runner-up" },
        ])}
      />,
    );
    // Rank-1 pick is the single headliner.
    const headliner = screen.getByLabelText("The one to plan around");
    expect(headliner.textContent).toContain("Event a");
    expect(headliner.textContent).not.toContain("Event b");
    // Rank-2 pick leads the best-of list with a Popular chip + rank badge.
    const bestOf = screen.getByLabelText("Best of the weekend");
    expect(bestOf.textContent).toContain("Event b");
    expect(bestOf.querySelectorAll(".weekend-chip-popular").length).toBe(1);
    expect(bestOf.querySelector(".weekend-ranked-list")).not.toBeNull();
  });

  it("shows no popular chips for a stale dataset (different weekend)", () => {
    const events = [makeEvent("b", SAT)];
    render(
      <WeekendView
        {...baseProps}
        events={events}
        popularPicks={{ ...dataset([]), weekendStart: "2020-01-04", picks: [{ eventId: "b", rank: 1 }] }}
      />,
    );
    expect(document.querySelectorAll(".weekend-chip-popular").length).toBe(0);
  });

  it("shows no popular chips when picks reference unknown ids", () => {
    // Sunday evening hours keep both events upcoming on any run day.
    const events = [makeEvent("b", SUN, 17), makeEvent("c", SUN, 18)];
    render(
      <WeekendView
        {...baseProps}
        events={events}
        popularPicks={dataset([{ eventId: "ghost", rank: 1 }])}
      />,
    );
    expect(document.querySelectorAll(".weekend-chip-popular").length).toBe(0);
    // The briefing still renders the weekend's real events.
    expect(screen.getByLabelText("Best of the weekend")).toBeInTheDocument();
  });
});
