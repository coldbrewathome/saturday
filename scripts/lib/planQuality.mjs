// Quality gates for generated featured plans: stops must be geo-coherent
// (no Dixon -> Aptos -> Vacaville ~150mi chains) and referenced events must
// not have ended. Pure helpers so they can be unit-tested and shared by
// generate-featured-plans.mjs and validate-events.mjs.

export const MAX_PLAN_RADIUS_MILES = 15;

export function milesBetween(a, b) {
  const radiusMiles = 3958.8;
  const toRad = (degrees) => (degrees * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return radiusMiles * 2 * Math.asin(Math.sqrt(h));
}

// Greedily keep items (in the given priority order) that stay within
// maxMiles of every already-kept item, up to limit. Items without usable
// coordinates are skipped — a plan stop we can't place can't be verified
// as coherent.
export function coherentPicks(items, limit = Infinity, maxMiles = MAX_PLAN_RADIUS_MILES) {
  const picks = [];
  for (const item of items) {
    if (picks.length >= limit) break;
    if (!Number.isFinite(item?.lat) || !Number.isFinite(item?.lon)) continue;
    if (picks.every((pick) => milesBetween(pick, item) <= maxMiles)) {
      picks.push(item);
    }
  }
  return picks;
}

function eventEndTime(event) {
  const end = event?.endDateTime ? Date.parse(event.endDateTime) : NaN;
  if (Number.isFinite(end)) return end;
  const start = event?.startDateTime ? Date.parse(event.startDateTime) : NaN;
  return start;
}

// Featured plans must never be generated around an event that has already
// started — "upcoming" picks served day-old events when generation only
// checked a -6h grace window.
export function eventStartsAtOrAfter(event, now = Date.now()) {
  const start = event?.startDateTime ? Date.parse(event.startDateTime) : NaN;
  return Number.isFinite(start) && start >= now;
}

// Returns one error string per featured plan that references an event whose
// end (or start, when no end is recorded) is already in the past.
export function expiredFeaturedPlanRefs(plans, eventsById, now = Date.now()) {
  const errors = [];
  for (const plan of plans || []) {
    for (const eventId of plan?.eventIds || []) {
      const event = eventsById.get(eventId);
      if (!event) continue;
      const end = eventEndTime(event);
      if (Number.isFinite(end) && end < now) {
        errors.push(
          `plan "${plan.id}" references ended event "${eventId}" (${event.title || "untitled"}, ended ${new Date(end).toISOString()}).`,
        );
      }
    }
  }
  return errors;
}
