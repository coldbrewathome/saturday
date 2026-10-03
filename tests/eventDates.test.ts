import { describe, expect, it } from "vitest";
import { eventTimeLabel } from "../src/eventDates";
import type { FamilyEvent } from "../src/App";

function timed(start: string, end: string): FamilyEvent {
  return { startDateTime: start, endDateTime: end } as FamilyEvent;
}

describe("eventTimeLabel", () => {
  it("labels day-long stamped rows 'All day' instead of their stamped hour", () => {
    // Date-only feed values (Miami/Broward Communico) arrive stamped with an
    // offset that lands midday in UTC — the old midnight-only rule printed a
    // literal "3:00 AM" for a day-long library drop-in.
    expect(
      eventTimeLabel(timed("2026-10-03T12:00:00.000Z", "2026-10-04T11:59:00.000Z")),
    ).toBe("All day");
  });

  it("keeps real start times for normal-length programs", () => {
    expect(
      eventTimeLabel(timed("2026-10-03T17:30:00.000Z", "2026-10-03T18:30:00.000Z")),
    ).not.toBe("All day");
  });

  it("keeps real start times for genuine multi-day runs", () => {
    expect(
      eventTimeLabel(timed("2026-10-03T17:30:00.000Z", "2026-10-05T00:00:00.000Z")),
    ).not.toBe("All day");
  });
});
