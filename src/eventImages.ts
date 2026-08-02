// Event photo resolution, honest by construction:
//   1. The event's REAL photo (event.imageUrl, extracted at ingest from
//      sources that provide one — Ticketmaster, Eventbrite-style feeds).
//   2. The VENUE's photo (a curated spot image whose name confidently
//      matches the event's venue) — it's the place, not a stock stand-in
//      for the event.
//   3. Otherwise null — surfaces render a neutral placeholder. There is
//      intentionally no category fallback: a stock photo passed off as
//      an event's photo is misleading (2026-08-02 directive).

import type { FamilyEvent } from "./App";

type SpotLike = { name: string; city?: string | null; imageUrl?: string };

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

// ── Venue-photo fallback ───────────────────────────────────────────────────
// When the event has no photo of its own, use the venue's curated spot photo
// (the place where the event happens — honest association, never a fake
// event photo).

function normalizeName(value: string): string {
  return (value || "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\bthe\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type VenueImageMap = ReadonlyMap<string, VenueEntry>;

// Shared empty map so optional-prop consumers never null-check.
export const EMPTY_VENUE_MAP: VenueImageMap = new Map();

type VenueEntry = { image: string; city: string };

/** Index of normalized spot name → photo + city (built once from spots). */
export function buildVenueImageMap(spots: SpotLike[]): VenueImageMap {
  const map = new Map<string, VenueEntry>();
  for (const spot of spots) {
    if (!spot.imageUrl) continue;
    const key = normalizeName(spot.name);
    if (key.length >= 3 && !map.has(key)) {
      map.set(key, { image: spot.imageUrl, city: normalizeName(spot.city || "") });
    }
  }
  return map;
}

function cityOk(spotCity: string, eventCity: string): boolean {
  if (!spotCity || !eventCity) return true;
  return spotCity === eventCity;
}

/**
 * Confident venue match: exact normalized name, or a mutual contains-match
 * (both sides >= 4 chars), never contradicted by differing cities. Returns
 * the venue's photo URL or null.
 */
export function venueImageFor(
  event: FamilyEvent,
  venueImages: ReadonlyMap<string, VenueEntry>,
): string | null {
  const venue = normalizeName(event.venue);
  const city = normalizeName(event.city);
  if (!venue) return null;
  const exact = venueImages.get(venue);
  if (exact && cityOk(exact.city, city)) return exact.image;
  for (const [name, entry] of venueImages) {
    if (name.length < 4 || venue.length < 4) continue;
    if (!(name.includes(venue) || venue.includes(name))) continue;
    if (!cityOk(entry.city, city)) continue;
    return entry.image;
  }
  return null;
}
