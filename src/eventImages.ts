// Event photo resolution. Events only ever show a REAL photo extracted at
// ingest (event.imageUrl, from sources that provide one — Ticketmaster,
// Eventbrite-style feeds). There is intentionally no category fallback: a
// stock photo passed off as an event's photo is misleading (2026-08-02
// directive). Surfaces render a neutral placeholder when no photo exists.

import type { FamilyEvent } from "./App";

/** The event's real photo URL, or null when the source provides none. */
export function eventImage(event: FamilyEvent, width = 1200): string | null {
  if (!event.imageUrl) return null;
  // Re-crop Unsplash-sourced images at the requested width; other hosts
  // are used as-is.
  if (event.imageUrl.includes("images.unsplash.com")) {
    return event.imageUrl.replace(/w=\d+/, `w=${width}`);
  }
  return event.imageUrl;
}

/** Small crop for feed cards. */
export function eventImageSmall(event: FamilyEvent): string | null {
  return eventImage(event, 400);
}
