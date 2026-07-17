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

  // E7: endDateTime in the past with no start at all must be false — the v1
  // bug returned true unconditionally whenever startDateTime was missing.
  it("E7: an ended endDateTime with no startDateTime is not upcoming", () => {
    expect(isUpcomingEvent({ endDateTime: "2026-06-08T20:00:00-07:00" }, NOW)).toBe(false);
  });

  // E8: date-only endDateTime means "the whole day" in the event's metro
  // timezone, not UTC midnight (which would flip freshness 4-5 hours early
  // for a US timezone).
  it("E8: date-only endDateTime holds until metro-local midnight", () => {
    const tz = { timeZone: "America/Los_Angeles" };
    expect(
      isUpcomingEvent({ endDateTime: "2026-06-09" }, new Date("2026-06-09T23:00:00-07:00"), tz),
    ).toBe(true);
    expect(
      isUpcomingEvent({ endDateTime: "2026-06-08" }, new Date("2026-06-09T00:30:00-07:00"), tz),
    ).toBe(false);
  });

  it("E9: a multi-day event spanning last week to next week stays upcoming", () => {
    expect(
      isUpcomingEvent(
        { startDateTime: "2026-06-02T10:00:00-07:00", endDateTime: "2026-06-16T20:00:00-07:00" },
        NOW,
      ),
    ).toBe(true);
  });

  // E10: a no-end event's "started today" grace must use the event's metro
  // timezone, not the viewer's — an ET viewer at 1am must not hide a PT event
  // still running at 10pm the same PT day, and vice versa the next day.
  it("E10: same-day grace for a no-end event uses the metro timezone", () => {
    const tz = { timeZone: "America/Los_Angeles" };
    const event = { startDateTime: "2026-06-08T21:00:00-07:00" };
    // 01:00 ET = 22:00 PT the same day the event started (Jun 8).
    expect(isUpcomingEvent(event, new Date("2026-06-09T01:00:00-04:00"), tz)).toBe(true);
    // 01:00 PT the next calendar day (Jun 9) — no longer "today" in PT.
    expect(isUpcomingEvent(event, new Date("2026-06-09T01:00:00-07:00"), tz)).toBe(false);
  });

  // E11: a data error (end before start) is never attendable.
  it("E11: endDateTime before startDateTime is treated as a data error", () => {
    expect(
      isUpcomingEvent(
        { startDateTime: "2026-06-09T18:00:00-07:00", endDateTime: "2026-06-09T10:00:00-07:00" },
        NOW,
      ),
    ).toBe(false);
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
