// Render-time freshness gate for event suggestions. Every surface that offers
// an event as a *suggestion* (editor's-pick forks, the ?guidePlan= handoff,
// planner candidates, Hop Now, browse map/list, "nearby this weekend" rails)
// must pass events through isUpcomingEvent so a past event never renders as
// something you could still go to.

type FreshnessEvent = {
  startDateTime?: string | null;
  endDateTime?: string | null;
};

type FreshnessOptions = {
  // IANA timezone of the event's metro (e.g. "America/Los_Angeles"). Governs
  // date-only string boundaries and the "started today" grace window so a PT
  // event doesn't flip freshness at ET midnight for an ET viewer, and vice
  // versa. Falls back to the runtime's local timezone when omitted.
  timeZone?: string;
};

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

function zonedDateParts(date: Date, timeZone?: string): { year: number; month: number; day: number } {
  if (!timeZone) {
    return { year: date.getFullYear(), month: date.getMonth() + 1, day: date.getDate() };
  }
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get("year"), month: get("month"), day: get("day") };
}

// UTC instant for local wall-clock Y-M-D H:M:S in `timeZone` (or the
// runtime's local zone when omitted). Intl formatters can render an instant
// in a timezone but not parse into one, so this uses the standard
// round-trip-offset technique: format an initial guess, measure how far off
// it landed, and correct by that amount.
function zonedWallClockToUtcMs(
  year: number,
  month: number, // 1-based
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone?: string,
): number {
  if (!timeZone) {
    return new Date(year, month - 1, day, hour, minute, second).getTime();
  }
  const guessUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(guessUtcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const observedAsUtcMs = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  return guessUtcMs - (observedAsUtcMs - guessUtcMs);
}

// A bare YYYY-MM-DD string means "the whole day" in the event's metro
// timezone: start-of-day (00:00:00.000) or end-of-day (23:59:59.999).
function dateOnlyBoundaryMs(value: string, timeZone: string | undefined, endOfDay: boolean): number {
  const [year, month, day] = value.split("-").map(Number);
  return endOfDay
    ? zonedWallClockToUtcMs(year, month, day, 23, 59, 59, timeZone) + 999
    : zonedWallClockToUtcMs(year, month, day, 0, 0, 0, timeZone);
}

function parseBoundary(value: string | null | undefined, timeZone: string | undefined, endOfDay: boolean): number {
  if (!value) return NaN;
  if (DATE_ONLY_RE.test(value)) return dateOnlyBoundaryMs(value, timeZone, endOfDay);
  return Date.parse(value);
}

export function isUpcomingEvent(
  event: FreshnessEvent,
  now: Date = new Date(),
  options: FreshnessOptions = {},
): boolean {
  const { timeZone } = options;
  const start = parseBoundary(event.startDateTime, timeZone, false);
  const end = parseBoundary(event.endDateTime, timeZone, true);

  if (event.endDateTime && Number.isNaN(end)) return false; // malformed end date
  if (event.startDateTime && Number.isNaN(start)) return false; // malformed start ("TBD")

  if (Number.isFinite(end)) {
    // Data error: an end before the start is never attendable.
    if (Number.isFinite(start) && end < start) return false;
    return end >= now.getTime();
  }

  if (!event.startDateTime) return true; // recurring series keep recurring
  if (start >= now.getTime()) return true;

  // Started with no listed end: treat as plausibly still running only while
  // it's the same calendar day *in the event's metro timezone* — an
  // afternoon festival shouldn't vanish at its start minute, but yesterday's
  // event must never resurface as upcoming.
  const startDay = zonedDateParts(new Date(start), timeZone);
  const nowDay = zonedDateParts(now, timeZone);
  return (
    startDay.year === nowDay.year &&
    startDay.month === nowDay.month &&
    startDay.day === nowDay.day
  );
}

// The "Weekend" When-filter window: Friday evening (5pm+) through Sunday.
// A Friday-night plan is weekend territory; the chip is labeled
// "Weekend (Fri–Sun)" to match.
export function isWeekendWindowDate(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return true;
  return dow === 5 && date.getHours() >= 17;
}
