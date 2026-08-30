import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import WeekendView from "../src/WeekendView";
import type { FamilyEvent } from "../src/App";
import type { MetroConfig } from "../src/metros";
import type { WeatherForecast } from "../src/api";

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

// Same upcomingWeekend math as the view.
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

const SUN = (() => {
  const d = upcomingWeekend();
  d.setDate(d.getDate() + 1);
  return d;
})();

function makeEvent(id: string): FamilyEvent {
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
    // Sunday evening — upcoming on any run day.
    startDateTime: `${key(SUN)}T18:00:00`,
    fetchedAt: "2026-01-01T00:00:00Z",
  } as FamilyEvent;
}

const baseProps = {
  events: [makeEvent("a")],
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

function forecast(overrides: Partial<WeatherForecast> = {}): WeatherForecast {
  return {
    saturday: { date: "2026-08-15", weatherCode: 0, label: "Sunny", tempMaxF: 84, tempMinF: 60, precipChance: 5 },
    sunday: { date: "2026-08-16", weatherCode: 61, label: "Rain", tempMaxF: 68, tempMinF: 58, precipChance: 75 },
    fetchedAt: "2026-08-14T00:00:00Z",
    ...overrides,
  };
}

describe("WeekendView weather brief", () => {
  it("renders Sat/Sun pills with temps and rain chance", () => {
    render(<WeekendView {...baseProps} weather={forecast()} />);
    const group = screen.getByLabelText("Weekend weather");
    expect(group.textContent).toContain("Sat");
    expect(group.textContent).toContain("84°");
    expect(group.textContent).toContain("Sun");
    expect(group.textContent).toContain("68°");
    expect(group.textContent).toContain("☔ 75%");
  });

  it("shows the dry-day hint when only Saturday is dry", () => {
    render(<WeekendView {...baseProps} weather={forecast()} />);
    expect(screen.getByText(/Saturday's the dry day/)).toBeInTheDocument();
  });

  it("renders no weather section without a forecast", () => {
    render(<WeekendView {...baseProps} weather={null} />);
    expect(screen.queryByLabelText("Weekend weather")).not.toBeInTheDocument();
  });
});
