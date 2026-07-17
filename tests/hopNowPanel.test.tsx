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
