import type { FamilyEvent } from "./types";

/**
 * The feed's `verified` bit means the facts passed an ingest gate; it does
 * not mean that a retained or recurring record was checked on this build.
 * Keep those states explicit in every visitor-facing surface.
 */
export type EventTrustKind = "current" | "previously-listed" | "recurring";

export type EventTrustDisplay = {
  kind: EventTrustKind;
  label: string;
  /** Safe copy for a link to the organizer's listing. */
  linkLabel: string;
};

export function eventTrustDisplay(event: FamilyEvent): EventTrustDisplay | null {
  if (event.sourceMode === "last-known-good") {
    return {
      kind: "previously-listed",
      label: "Previously listed",
      linkLabel: "Previously listed · Check organizer",
    };
  }

  if (event.sourceMode === "recurring-template") {
    return {
      kind: "recurring",
      label: "Recurring listing",
      linkLabel: "Recurring listing · Check organizer",
    };
  }

  if (event.verified && event.url) {
    return {
      kind: "current",
      label: "Verified",
      linkLabel: "Verified",
    };
  }

  return null;
}

function calendarDate(value: string): string | null {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** Build a Google Calendar template only when both times are known. */
export function eventCalendarUrl(event: FamilyEvent): string | null {
  if (!event.startDateTime) return null;
  const start = calendarDate(event.startDateTime);
  if (!start) return null;
  const parsedStart = new Date(event.startDateTime);
  const parsedEnd = event.endDateTime ? new Date(event.endDateTime) : null;
  const end = parsedEnd && Number.isFinite(parsedEnd.getTime()) && parsedEnd >= parsedStart
    ? calendarDate(event.endDateTime!)
    : null;
  if (!end) return null;
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${start}/${end}`,
    details: event.description || "",
    location: [event.venue, event.city].filter(Boolean).join(", "),
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
