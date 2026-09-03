import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import EventDetailView from "../src/EventDetailView";
import type { FamilyEvent } from "../src/App";
import type { MetroConfig } from "../src/metros";

beforeEach(() => {
  // fetchEventTrust caches per-event results in sessionStorage — drop it so
  // each render sees the fetch mock below rather than a cached answer.
  sessionStorage.clear();
  // The trust effect fetches the check-in aggregate on mount (API_BASE is
  // non-empty in tests via .env). Keep every render hermetic: 404 → null.
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: false, status: 404 }) as Response),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
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

  it("shows the verified trust line with source host for verified events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00-07:00"));
    const event = makeEvent({ id: "e1", slug: "storytime" });
    render(<EventDetailView {...baseProps} events={[event]} slug="storytime" />);
    expect(screen.getByText("Verified · sfpl.org")).toHaveAttribute(
      "href",
      "https://sfpl.org/events/storytime",
    );
    expect(screen.getByText("How we verify")).toHaveAttribute(
      "href",
      "/how-we-verify/",
    );
    vi.useRealTimers();
  });

  it("omits the trust line for unverified events", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00-07:00"));
    const event = makeEvent({ id: "e1", slug: "storytime", verified: false });
    render(<EventDetailView {...baseProps} events={[event]} slug="storytime" />);
    expect(screen.queryByText(/^Verified ·/)).not.toBeInTheDocument();
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

  it("renders hero placeholder, age-fit line, facts, and the map link", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00-07:00"));
    const event = makeEvent({
      id: "e1",
      slug: "storytime",
      ageBands: ["toddler", "preschool"],
      endDateTime: "2026-06-13T11:30:00-07:00",
    });
    const { container } = render(
      <EventDetailView {...baseProps} events={[event]} slug="storytime" />,
    );

    // No source photo → neutral placeholder, never a stock stand-in.
    expect(container.querySelector("img.event-detail-hero")).toBeNull();
    expect(container.querySelector(".event-detail-hero-placeholder")).not.toBeNull();

    expect(
      screen.getByText("Best for: Toddler (1-3) · Preschool (3-5)"),
    ).toBeInTheDocument();

    expect(screen.getByText("Cost")).toBeInTheDocument();
    expect(screen.getByText("Free")).toBeInTheDocument();
    expect(screen.getByText("Duration")).toBeInTheDocument();
    expect(screen.getByText("1.5 hours")).toBeInTheDocument();
    expect(screen.getByText(/^Morning/)).toBeInTheDocument();
    expect(screen.getByText("Neighborhood")).toBeInTheDocument();
    expect(screen.getByText("Civic Center")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: "See it on the map" })).toHaveAttribute(
      "href",
      "#/browse",
    );
    vi.useRealTimers();
  });

  it("renders the real source photo when the event has one", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00-07:00"));
    const event = makeEvent({
      id: "e1",
      slug: "ticketed-show",
      imageUrl: "https://media.ticketmaster.com/tm/photo-real.jpg",
    });
    const { container } = render(
      <EventDetailView {...baseProps} events={[event]} slug="ticketed-show" />,
    );
    const hero = container.querySelector("img.event-detail-hero");
    expect(hero).toHaveAttribute("src", "https://media.ticketmaster.com/tm/photo-real.jpg");
    expect(container.querySelector(".event-detail-hero-placeholder")).toBeNull();
    vi.useRealTimers();
  });

  it("skips facts whose data is missing", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00-07:00"));
    const event = makeEvent({
      id: "e1",
      slug: "storytime",
      cost: "Unknown",
      timeWindow: undefined,
      neighborhood: undefined,
      startDateTime: undefined,
      endDateTime: undefined,
    });
    render(<EventDetailView {...baseProps} events={[event]} slug="storytime" />);
    expect(screen.queryByText("Cost")).not.toBeInTheDocument();
    expect(screen.queryByText("Time")).not.toBeInTheDocument();
    expect(screen.queryByText("Duration")).not.toBeInTheDocument();
    expect(screen.queryByText("Neighborhood")).not.toBeInTheDocument();
    vi.useRealTimers();
  });

  // No startDateTime = recurring series = always upcoming, so these tests
  // need no clock pinning and waitFor runs on real timers.
  it("shows the trust line once the check-in aggregate has enough data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ worthIt: 8, notWorthIt: 2, total: 10, trustScore: 80 }),
      }) as Response),
    );
    const event = makeEvent({ id: "e1", slug: "storytime", startDateTime: undefined });
    render(<EventDetailView {...baseProps} events={[event]} slug="storytime" />);
    await waitFor(() => {
      expect(
        screen.getByText("80% of families said this was worth it (10 check-ins)"),
      ).toBeInTheDocument();
    });
  });

  it("never shows the trust line without enough check-ins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ worthIt: 1, notWorthIt: 1, total: 2, trustScore: 50 }),
      }) as Response),
    );
    const event = makeEvent({ id: "e1", slug: "storytime", startDateTime: undefined });
    render(<EventDetailView {...baseProps} events={[event]} slug="storytime" />);
    await waitFor(() => {
      expect(screen.queryByText(/said this was worth it/)).not.toBeInTheDocument();
    });
  });
});
