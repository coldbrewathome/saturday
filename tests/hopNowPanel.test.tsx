import "@testing-library/jest-dom/vitest";
import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { HopNowPanel, type FamilyEvent } from "../src/App";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function makeEvent(overrides: Partial<FamilyEvent> & { id: string }): FamilyEvent {
  return {
    title: "Pop-up Trivia",
    description: "",
    venue: "Corner Bar",
    city: "San Francisco",
    neighborhood: "Mission",
    lat: 37.7749,
    lon: -122.4194,
    category: "Community",
    daysOfWeek: [6],
    timeWindow: "Evening",
    ageBands: [],
    cost: "Free",
    url: "https://example.com/trivia",
    verified: true,
    ...overrides,
  } as FamilyEvent;
}

// E28: a Hop Now panel left open must not keep suggesting an event that has
// since ended — a coarse tick (5-min interval / visibilitychange) forces the
// freshness-gated memo to recompute even with no other prop change.
describe("HopNowPanel B1.7 clock tick", () => {
  it("drops a short event from suggestions once it ends, without any prop change", () => {
    vi.useFakeTimers();
    const start = new Date("2026-06-13T18:00:00-07:00");
    vi.setSystemTime(start);

    // Starts in 2 minutes, ends in 3 — a very short event, so hopNow's own
    // "not yet started" acceptance path (which doesn't check endDateTime)
    // takes it, and the outer freshness gate is the only thing that can
    // later exclude it.
    const event = makeEvent({
      id: "short-trivia",
      startDateTime: new Date(start.getTime() + 2 * 60_000).toISOString(),
      endDateTime: new Date(start.getTime() + 3 * 60_000).toISOString(),
    });

    render(
      <HopNowPanel
        spots={[]}
        events={[event]}
        userLocation={null}
        audience="adults"
        activePlanName={null}
        onAddToPlan={() => {}}
        onClose={() => {}}
        metroTimeZone="America/Los_Angeles"
      />,
    );

    expect(screen.getByText(/pop-up trivia/i)).toBeInTheDocument();

    // Advance past the event's end and past the 5-minute tick interval.
    act(() => {
      vi.setSystemTime(new Date(start.getTime() + 6 * 60_000));
      vi.advanceTimersByTime(5 * 60_000);
    });

    expect(screen.queryByText(/pop-up trivia/i)).not.toBeInTheDocument();
  });
});

// The panel used to omit `weather`, so hopNow's wet-weather boost was dead
// code no caller could reach — a rainy day still surfaced the park first.
describe("HopNowPanel weather", () => {
  const SUNDAY_3PM = new Date("2026-06-14T15:00:00-07:00");

  const spot = (id: string, name: string, category: string, friendScore: number) =>
    ({
      id,
      name,
      category,
      neighborhood: "Mission",
      lat: 37.76,
      lon: -122.43,
      kidsFriendly: true,
      friendScore,
      schedule: {
        is247: false,
        days: Object.fromEntries(
          ["mon", "tue", "wed", "thu", "fri", "sat", "sun"].map((day) => [
            day,
            [{ open: 9 * 60, close: 20 * 60 }],
          ]),
        ),
      },
    }) as never;

  const renderPanel = (weather?: "wet" | "dry" | "mixed") =>
    render(
      <HopNowPanel
        spots={[
          spot("park", "Sunny Park", "Outdoors", 95),
          spot("museum", "Indoor Museum", "Culture", 80),
        ]}
        events={[]}
        userLocation={{ lat: 37.78, lon: -122.42 }}
        audience="kids"
        activePlanName={null}
        onAddToPlan={() => {}}
        onClose={() => {}}
        metroTimeZone="America/Los_Angeles"
        weather={weather}
      />,
    );

  const firstName = () =>
    screen.getAllByRole("heading", { level: 3 })[0].textContent;

  it("ranks the indoor pick first on a wet day, despite a lower friend score", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SUNDAY_3PM);
    renderPanel("wet");
    expect(firstName()).toBe("Indoor Museum");
  });

  it("keeps the higher-scoring park first when no forecast is passed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(SUNDAY_3PM);
    renderPanel();
    expect(firstName()).toBe("Sunny Park");
  });
});
