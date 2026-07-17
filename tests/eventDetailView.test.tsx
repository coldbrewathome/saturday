import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import EventDetailView from "../src/EventDetailView";
import type { FamilyEvent } from "../src/App";
import type { MetroConfig } from "../src/metros";

afterEach(() => {
  cleanup();
});

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

function makeEvent(overrides: Partial<FamilyEvent> & { id: string; slug: string }): FamilyEvent {
  return {
    title: "Storytime",
    description: "",
    venue: "Main Library",
    city: "San Francisco",
    neighborhood: "Civic Center",
    lat: 37.78,
    lon: -122.41,
    category: "Family",
    daysOfWeek: [6],
    timeWindow: "Morning",
    ageBands: [],
    cost: "Free",
    url: "https://sfpl.org/events/storytime",
    verified: true,
    startDateTime: "2026-06-13T10:00:00-07:00",
    ...overrides,
  } as FamilyEvent;
}

const baseProps = {
  metro,
  onBack: () => {},
  activePlanName: null,
  planEventIds: [],
  onAddToPlan: () => {},
  onShare: () => {},
  shareCopiedUrl: null,
  shareUrlFor: (slug: string) => `https://famhop.com/bay-area/event/${slug}/`,
};

describe("EventDetailView", () => {
  it("renders the live event when it's upcoming", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00-07:00"));
    const event = makeEvent({ id: "e1", slug: "storytime", startDateTime: "2026-06-13T10:00:00-07:00" });
    render(<EventDetailView {...baseProps} events={[event]} slug="storytime" />);
    expect(screen.getByRole("heading", { name: "Storytime" })).toBeInTheDocument();
    expect(screen.queryByText(/this event has ended/i)).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  // E26: a slug that still resolves in the feed but whose event has already
  // ended must show the "ended" state — never live/attendable copy.
  it("shows the ended state for a present-but-past event still in the feed", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-13T20:00:00-07:00"));
    const event = makeEvent({
      id: "e2",
      slug: "past-storytime",
      startDateTime: "2026-06-13T10:00:00-07:00",
      endDateTime: "2026-06-13T11:00:00-07:00",
    });
    render(<EventDetailView {...baseProps} events={[event]} slug="past-storytime" />);
    expect(screen.getByText(/this event has ended/i)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Storytime" })).not.toBeInTheDocument();
    vi.useRealTimers();
  });
});
