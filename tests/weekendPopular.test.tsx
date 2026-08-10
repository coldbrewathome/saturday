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
// the feed is currently showing for the section to appear.
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

describe("WeekendView popular section", () => {
  it("renders the ranked popular section with chips when picks match the weekend", () => {
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
    expect(screen.getByText("Popular this weekend")).toBeInTheDocument();
    // Rank order: the rank-1 pick's title appears before rank-2's.
    const section = screen.getByLabelText("Popular this weekend");
    expect(section.textContent?.indexOf("Event a")).toBeGreaterThan(-1);
    expect(section.textContent!.indexOf("Event a")).toBeLessThan(
      section.textContent!.indexOf("Event b"),
    );
    // Chips on the popular cards.
    expect(section.querySelectorAll(".weekend-chip-popular").length).toBe(2);
    // Rank badges 1, 2.
    expect(section.querySelector(".weekend-popular-list li::before")).toBeDefined();
  });

  it("hides the section for a stale dataset (different weekend)", () => {
    const events = [makeEvent("b", SAT)];
    render(
      <WeekendView
        {...baseProps}
        events={events}
        popularPicks={{ ...dataset([]), weekendStart: "2020-01-04", picks: [{ eventId: "b", rank: 1 }] }}
      />,
    );
    expect(screen.queryByText("Popular this weekend")).not.toBeInTheDocument();
  });

  it("hides the section when picks reference unknown ids", () => {
    const events = [makeEvent("b", SAT)];
    render(
      <WeekendView
        {...baseProps}
        events={events}
        popularPicks={dataset([{ eventId: "ghost", rank: 1 }])}
      />,
    );
    expect(screen.queryByText("Popular this weekend")).not.toBeInTheDocument();
  });
});
