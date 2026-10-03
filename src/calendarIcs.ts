// Calendar file (.ics) export — Apple Calendar, Outlook, and anything else
// that is not Google (src/eventTrust.ts covers the Google template link).
// Pure builders, so the RFC 5545 details are testable without a DOM.
import { APP_BRAND } from "./appConfig";
import { isAllDayEvent, isoDate, validEventDate } from "./eventDates";
import type { FamilyEvent, PlanItem } from "./types";

const PRODID = `-//${APP_BRAND}//Weekend planner//EN`;
const UID_DOMAIN = "famhop.com";

// RFC 5545 TEXT: backslash, semicolon, comma and newlines are escaped.
function escapeText(value: string): string {
  return String(value ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

// Content lines are folded at 75 octets with CRLF + space; count UTF-8 bytes
// per code point so a multi-byte character is never split across the fold.
const encoder = new TextEncoder();
const byteLength = (text: string): number => encoder.encode(text).length;

function foldLine(line: string): string {
  if (byteLength(line) <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let limit = 75;
  for (const char of line) {
    if (byteLength(current + char) > limit) {
      parts.push(current);
      current = char;
      limit = 74; // continuation lines carry a leading space
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts.join("\r\n ");
}

function contentLine(name: string, value: string): string {
  return foldLine(`${name}:${escapeText(value)}`);
}

function utcStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

function localDateStamp(date: Date): string {
  return isoDate(date).replace(/-/g, "");
}

function nextLocalDayStamp(date: Date): string {
  return localDateStamp(new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1));
}

function eventLocation(event: FamilyEvent): string {
  return [event.venue, event.city].filter(Boolean).join(", ");
}

function eventUid(event: FamilyEvent): string {
  return `${event.id || event.slug}@${UID_DOMAIN}`;
}

// All-day rows use date-only values (DTEND is exclusive); timed rows use UTC
// instants, so no VTIMEZONE block is needed and every client agrees.
function timingLines(start: Date, end: Date, allDay: boolean): string[] {
  if (allDay) {
    return [
      `DTSTART;VALUE=DATE:${localDateStamp(start)}`,
      `DTEND;VALUE=DATE:${nextLocalDayStamp(start)}`,
    ];
  }
  return [`DTSTART:${utcStamp(start)}`, `DTEND:${utcStamp(end)}`];
}

function wrapCalendar(lines: string[]): string {
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    `PRODID:${PRODID}`,
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...lines,
    "END:VCALENDAR",
    "",
  ].join("\r\n");
}

function eventLines(event: FamilyEvent, now: Date): string[] | null {
  const start = validEventDate(event.startDateTime);
  if (!start) return null;
  const end = validEventDate(event.endDateTime);
  const allDay = isAllDayEvent(event);
  if (!allDay && (!end || end.getTime() < start.getTime())) return null;
  return [
    "BEGIN:VEVENT",
    `UID:${eventUid(event)}`,
    `DTSTAMP:${utcStamp(now)}`,
    ...timingLines(start, end ?? start, allDay),
    contentLine("SUMMARY", event.title),
    ...(eventLocation(event) ? [contentLine("LOCATION", eventLocation(event))] : []),
    ...(event.description ? [contentLine("DESCRIPTION", event.description)] : []),
    ...(event.url ? [`URL:${event.url}`] : []),
    "END:VEVENT",
  ];
}

/** One event as an .ics file body, or null when it has no usable start time. */
export function buildEventIcs(event: FamilyEvent, now: Date = new Date()): string | null {
  const lines = eventLines(event, now);
  return lines ? wrapCalendar(lines) : null;
}

export type PlanCalendarInput = {
  name: string;
  items: PlanItem[];
  /** Share/poll URL, so the calendar entry links back to the plan. */
  url?: string | null;
};

/**
 * A plan is one outing, so it becomes one calendar entry covering its window,
 * with the ordered itinerary in the description. Spots carry opening hours but
 * no visit time — inventing one per stop would put wrong times in a user's
 * calendar, and one entry per stop would fragment the outing.
 */
export function buildPlanIcs(
  { name, items, url }: PlanCalendarInput,
  now: Date = new Date(),
): string | null {
  const timed = items
    .map((item) => {
      if (item.kind !== "event") return null;
      const start = validEventDate(item.event.startDateTime);
      if (!start) return null;
      const end = validEventDate(item.event.endDateTime);
      return { start, end: end && end.getTime() > start.getTime() ? end : null };
    })
    .filter((entry): entry is { start: Date; end: Date | null } => entry !== null);
  if (timed.length === 0) return null;

  const starts = timed.map((entry) => entry.start.getTime());
  const start = new Date(Math.min(...starts));
  const ends = timed.map((entry) => entry.end?.getTime() ?? entry.start.getTime() + 2 * 60 * 60 * 1000);
  const end = new Date(Math.max(...ends));

  const itinerary = items.map((item, index) => {
    if (item.kind === "spot") {
      const hours = item.spot.openingHours ? ` (${item.spot.openingHours})` : "";
      return `${index + 1}. ${item.spot.name}${hours}`;
    }
    const when = validEventDate(item.event.startDateTime)
      ? new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(
          new Date(item.event.startDateTime as string),
        )
      : "time TBA";
    const venue = item.event.venue ? ` at ${item.event.venue}` : "";
    return `${index + 1}. ${when} — ${item.event.title}${venue}`;
  });
  const description = [...itinerary, ...(url ? ["", url] : [])].join("\n");

  return wrapCalendar([
    "BEGIN:VEVENT",
    `UID:plan-${utcStamp(now)}@${UID_DOMAIN}`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${utcStamp(start)}`,
    `DTEND:${utcStamp(end)}`,
    contentLine("SUMMARY", `${APP_BRAND} plan: ${name}`),
    ...(items.length > 0 ? [contentLine("DESCRIPTION", description)] : []),
    "END:VEVENT",
  ]);
}

/** Hand the file to the browser. No-op when the file could not be built. */
export function downloadIcs(filename: string, ics: string | null): boolean {
  if (!ics || typeof document === "undefined") return false;
  const blob = new Blob([ics], { type: "text/calendar;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revoking synchronously can cancel the download in Safari; let the click
  // settle first.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}
