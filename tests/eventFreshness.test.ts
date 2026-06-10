import { describe, expect, it } from "vitest";
import { isUpcomingEvent, isWeekendWindowDate } from "../src/eventFreshness";

// Tuesday, June 9 2026, 6:00 PM Pacific (matches the audit scenario where
// June 7 events were still offered as "upcoming" on June 9).
const NOW = new Date("2026-06-09T18:00:00-07:00");

describe("isUpcomingEvent", () => {
  it("keeps recurring events without a startDateTime", () => {
    expect(isUpcomingEvent({}, NOW)).toBe(true);
    expect(isUpcomingEvent({ startDateTime: null }, NOW)).toBe(true);
  });

  it("rejects events whose start passed on an earlier day", () => {
    expect(
      isUpcomingEvent({ startDateTime: "2026-06-07T10:00:00-07:00" }, NOW),
    ).toBe(false);
  });

  it("keeps events starting in the future", () => {
    expect(
      isUpcomingEvent({ startDateTime: "2026-06-13T10:00:00-07:00" }, NOW),
    ).toBe(true);
  });

  it("keeps same-day events that started earlier but list no end", () => {
    expect(
      isUpcomingEvent({ startDateTime: "2026-06-09T10:00:00-07:00" }, NOW),
    ).toBe(true);
  });

  it("keeps ongoing events whose end is still ahead", () => {
    expect(
      isUpcomingEvent(
        {
          startDateTime: "2026-06-08T10:00:00-07:00",
          endDateTime: "2026-06-10T17:00:00-07:00",
        },
        NOW,
      ),
    ).toBe(true);
  });

  it("rejects events that already ended today", () => {
    expect(
      isUpcomingEvent(
        {
          startDateTime: "2026-06-09T09:00:00-07:00",
          endDateTime: "2026-06-09T11:00:00-07:00",
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("rejects malformed start dates", () => {
    expect(isUpcomingEvent({ startDateTime: "not-a-date" }, NOW)).toBe(false);
  });
});

describe("isWeekendWindowDate", () => {
  it("includes Friday evening from 5pm", () => {
    expect(isWeekendWindowDate(new Date("2026-06-12T17:00:00-07:00"))).toBe(true);
    expect(isWeekendWindowDate(new Date("2026-06-12T21:30:00-07:00"))).toBe(true);
  });

  it("excludes Friday before 5pm", () => {
    expect(isWeekendWindowDate(new Date("2026-06-12T16:59:00-07:00"))).toBe(false);
  });

  it("includes all of Saturday and Sunday", () => {
    expect(isWeekendWindowDate(new Date("2026-06-13T08:00:00-07:00"))).toBe(true);
    expect(isWeekendWindowDate(new Date("2026-06-14T22:00:00-07:00"))).toBe(true);
  });

  it("excludes weekdays", () => {
    expect(isWeekendWindowDate(new Date("2026-06-11T19:00:00-07:00"))).toBe(false);
  });
});
