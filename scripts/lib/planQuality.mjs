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

// C1.2/C1.3: pairwise radius alone allows a 15-mi hop between consecutive
// stops, or a "pairwise close but zigzag" path (4 stops mutually <=14mi apart
// can still make a 42-mi ping-pong route in the wrong order).
export const MAX_PLAN_LEG_MILES = 12;
export const MAX_PLAN_PATH_MILES = 25;

export function maxLegMiles(points) {
  let max = 0;
  for (let i = 1; i < points.length; i++) {
    max = Math.max(max, milesBetween(points[i - 1], points[i]));
  }
  return max;
}

export function totalPathMiles(points) {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += milesBetween(points[i - 1], points[i]);
  }
  return total;
}

// Reorders points nearest-neighbor starting from the first point, so a plan
// visits stops in a roughly monotone path instead of a ping-pong zigzag.
export function nearestNeighborOrder(points) {
  if (points.length <= 2) return points.slice();
  const remaining = points.slice(1);
  const ordered = [points[0]];
  while (remaining.length > 0) {
    const last = ordered[ordered.length - 1];
    let bestIndex = 0;
    let bestDistance = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const distance = milesBetween(last, remaining[i]);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    ordered.push(remaining[bestIndex]);
    remaining.splice(bestIndex, 1);
  }
  return ordered;
}

// Audits a plan's stop geometry: pairwise radius (C1.1), max single leg
// (C1.2), and total path length (C1.3) in stop order — flagging when a
// nearest-neighbor reorder of the same stops would be compliant (C1.4, so
// generators know to fix the order rather than drop stops). A stopId that
// doesn't resolve to coordinates is a validation failure (C1.5), and a plan
// left with fewer than 2 resolvable stops is flagged rather than padded.
// `resolveStop(stopId)` must return `{ lat, lon }` or a nullish value.
export function auditPlanGeometry(plan, resolveStop, options = {}) {
  const maxRadius = options.maxRadiusMiles ?? MAX_PLAN_RADIUS_MILES;
  const maxLeg = options.maxLegMiles ?? MAX_PLAN_LEG_MILES;
  const maxPath = options.maxPathMiles ?? MAX_PLAN_PATH_MILES;
  const errors = [];
  const planId = plan?.id ?? "(unknown)";
  const stopIds = Array.isArray(plan?.stopIds) ? plan.stopIds : [];

  const resolved = [];
  for (const stopId of stopIds) {
    const point = resolveStop(stopId);
    if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lon)) {
      errors.push(`plan "${planId}" has an unresolvable stop "${stopId}".`);
      continue;
    }
    resolved.push({ lat: point.lat, lon: point.lon, stopId });
  }

  if (resolved.length < 2) {
    // A plan that only ever declared 0-1 stops (e.g. a single anchor spot
    // paired with events) was never attempting a multi-stop path — there's
    // no geometry to audit. Only flag "too few" when the plan *did* declare
    // >=2 stops and some failed to resolve (C1.5's actual failure mode: a
    // multi-stop plan silently degrading instead of being dropped).
    if (stopIds.length >= 2) {
      errors.push(`plan "${planId}" has fewer than 2 resolvable stops (${resolved.length} of ${stopIds.length}).`);
    }
    return errors;
  }

  for (let i = 0; i < resolved.length; i++) {
    for (let j = i + 1; j < resolved.length; j++) {
      const distance = milesBetween(resolved[i], resolved[j]);
      if (distance > maxRadius) {
        errors.push(
          `plan "${planId}" stops "${resolved[i].stopId}" and "${resolved[j].stopId}" are ${distance.toFixed(1)}mi apart (max ${maxRadius}mi).`,
        );
      }
    }
  }

  const givenLeg = maxLegMiles(resolved);
  const givenPath = totalPathMiles(resolved);
  if (givenLeg > maxLeg || givenPath > maxPath) {
    const reordered = nearestNeighborOrder(resolved);
    const reorderedLeg = maxLegMiles(reordered);
    const reorderedPath = totalPathMiles(reordered);
    if (reorderedLeg <= maxLeg && reorderedPath <= maxPath) {
      errors.push(
        `plan "${planId}" stop order isn't geo-monotone (leg ${givenLeg.toFixed(1)}mi, path ${givenPath.toFixed(1)}mi) — a compliant nearest-neighbor order of the same stops exists.`,
      );
    } else {
      if (reorderedLeg > maxLeg) {
        errors.push(`plan "${planId}" max leg is ${reorderedLeg.toFixed(1)}mi even nearest-neighbor ordered (max ${maxLeg}mi).`);
      }
      if (reorderedPath > maxPath) {
        errors.push(`plan "${planId}" total path is ${reorderedPath.toFixed(1)}mi even nearest-neighbor ordered (max ${maxPath}mi).`);
      }
    }
  }

  return errors;
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
