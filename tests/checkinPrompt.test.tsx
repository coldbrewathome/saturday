import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import CheckinPrompt from "../src/CheckinPrompt";
import {
  computeCheckinCandidates,
  inCheckinWindow,
} from "../src/checkinQueue";
import type { FamilyEvent } from "../src/App";

afterEach(() => {
  cleanup();
});

function makeEvent(overrides: Partial<FamilyEvent> & { id: string }): FamilyEvent {
  return {
    title: "Park Festival",
    description: "",
    venue: "Central Park",
    city: "San Francisco",
    neighborhood: "Mission",
    lat: 37.7749,
    lon: -122.4194,
    category: "Festival",
    daysOfWeek: [6],
    timeWindow: "Afternoon",
    startDateTime: "2026-07-26T13:00:00-07:00",
    endDateTime: "2026-07-26T17:00:00-07:00",
    ageBands: [],
    cost: "Free",
    url: "https://example.com/festival",
    verified: true,
    ...overrides,
  } as FamilyEvent;
}

describe("inCheckinWindow", () => {
  it("allows Monday and Tuesday", () => {
    // 2026-08-03 is a Monday.
    expect(inCheckinWindow(new Date("2026-08-03T10:00:00-07:00"))).toBe(true);
    // 2026-08-04 is a Tuesday.
    expect(inCheckinWindow(new Date("2026-08-04T10:00:00-07:00"))).toBe(true);
  });

  it("blocks Sunday before 6pm but allows Sunday evening", () => {
    expect(inCheckinWindow(new Date("2026-08-02T12:00:00-07:00"))).toBe(false);
    expect(inCheckinWindow(new Date("2026-08-02T19:00:00-07:00"))).toBe(true);
  });

  it("blocks Wednesday through Saturday", () => {
    // 2026-08-05 is a Wednesday.
    expect(inCheckinWindow(new Date("2026-08-05T10:00:00-07:00"))).toBe(false);
  });
});

describe("computeCheckinCandidates", () => {
  const now = new Date("2026-08-03T10:00:00-07:00"); // Monday

  it("picks only saved, ended, unanswered events from the last 8 days", () => {
    const past = makeEvent({ id: "past", startDateTime: "2026-08-01T13:00:00-07:00" });
    const upcoming = makeEvent({
      id: "upcoming",
      startDateTime: "2026-08-08T13:00:00-07:00",
    });
    const answered = makeEvent({
      id: "answered",
      startDateTime: "2026-08-01T13:00:00-07:00",
    });
    const unsaved = makeEvent({
      id: "unsaved",
      startDateTime: "2026-08-01T13:00:00-07:00",
    });
    const tooOld = makeEvent({
      id: "too-old",
      startDateTime: "2026-07-20T13:00:00-07:00",
    });

    const queue = computeCheckinCandidates(
      [past, upcoming, answered, unsaved, tooOld],
      ["past", "answered", "too-old"],
      { answered: { date: "2026-08-02T09:00:00-07:00", worthIt: true } },
      now,
      "America/Los_Angeles",
    );

    expect(queue.map((e) => e.id)).toEqual(["past"]);
  });

  it("caps the queue at three and returns empty outside the window", () => {
    const events = ["a", "b", "c", "d"].map((id) =>
      makeEvent({ id, startDateTime: "2026-08-01T13:00:00-07:00" }),
    );
    const queue = computeCheckinCandidates(
      events,
      ["a", "b", "c", "d"],
      {},
      now,
      "America/Los_Angeles",
    );
    expect(queue).toHaveLength(3);

    // Wednesday: no window, no prompts.
    const wednesday = new Date("2026-08-05T10:00:00-07:00");
    expect(
      computeCheckinCandidates(events, ["a"], {}, wednesday, "America/Los_Angeles"),
    ).toHaveLength(0);
  });
});

describe("CheckinPrompt", () => {
  const event = makeEvent({ id: "past" });

  it("shows the event and three answer options", () => {
    render(
      <CheckinPrompt event={event} queueLength={1} answered={0} onAnswer={() => {}} />,
    );
    expect(screen.getByText("Did you go to this?")).toBeInTheDocument();
    expect(screen.getByText("Park Festival")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Worth it!/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Skip it/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Didn.t go/ })).toBeInTheDocument();
  });

  it("reports each answer through onAnswer", () => {
    const onAnswer = vi.fn();
    render(
      <CheckinPrompt event={event} queueLength={1} answered={0} onAnswer={onAnswer} />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Worth it!/ }));
    expect(onAnswer).toHaveBeenCalledWith(true);
    fireEvent.click(screen.getByRole("button", { name: /Skip it/ }));
    expect(onAnswer).toHaveBeenCalledWith(false);
    fireEvent.click(screen.getByRole("button", { name: /Didn.t go/ }));
    expect(onAnswer).toHaveBeenCalledWith(null);
  });

  it("renders progress dots for a multi-event queue", () => {
    const { container } = render(
      <CheckinPrompt event={event} queueLength={3} answered={1} onAnswer={() => {}} />,
    );
    expect(container.querySelectorAll(".checkin-progress span")).toHaveLength(3);
    expect(
      container.querySelectorAll(".checkin-progress span.active"),
    ).toHaveLength(2);
  });
});
