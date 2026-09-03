// Check-in API — "Did you go?" post-weekend feedback + aggregate trust scores.
// The aggregate (event trust) is public; submissions and the user's history
// require a session.

import { API_BASE } from "./api";

export type EventTrust = {
  worthIt: number;
  notWorthIt: number;
  total: number;
  /** 0-100 percentage of check-ins that were worth it, or null when empty. */
  trustScore: number | null;
};

export type UserCheckinRecord = Record<
  string,
  { date: string; worthIt: boolean }
>;

export async function submitCheckin(
  eventId: string,
  worthIt: boolean,
  sessionToken: string,
): Promise<void> {
  const response = await fetch(`${API_BASE}/checkin`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify({ eventId, worthIt }),
  });
  if (!response.ok) {
    throw new Error(`Check-in failed (${response.status})`);
  }
}

// Trust scores are read for every upcoming event on the weekend feed (~30 per
// view) but change rarely — cache per event so metro switches, re-renders and
// back-nav don't refire a parallel fetch storm. Successes live 6h, failures
// 60s (recovers fast from an outage without hammering the worker). The
// sessionStorage row is the only persistent cache; trustInFlight merely
// coalesces overlapping calls for the same event while one is in flight.
const TRUST_TTL_MS = 6 * 60 * 60 * 1000;
const TRUST_FAIL_TTL_MS = 60 * 1000;
const TRUST_CACHE_PREFIX = "checkinTrust:";
const trustInFlight = new Map<string, Promise<EventTrust | null>>();

function readCached(eventId: string): EventTrust | null | undefined {
  try {
    const raw = sessionStorage.getItem(`${TRUST_CACHE_PREFIX}${eventId}`);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { at: number; value: EventTrust | null };
    if (typeof parsed.at !== "number") return undefined;
    const age = Date.now() - parsed.at;
    const ttl = parsed.value ? TRUST_TTL_MS : TRUST_FAIL_TTL_MS;
    if (age < ttl) return parsed.value;
    sessionStorage.removeItem(`${TRUST_CACHE_PREFIX}${eventId}`);
    return undefined;
  } catch {
    return undefined;
  }
}

export async function fetchEventTrust(
  eventId: string,
): Promise<EventTrust | null> {
  const fresh = readCached(eventId);
  if (fresh !== undefined) return fresh;
  const inflight = trustInFlight.get(eventId);
  if (inflight) return inflight;
  const promise = (async (): Promise<EventTrust | null> => {
    let value: EventTrust | null = null;
    if (API_BASE) {
      try {
        const response = await fetch(`${API_BASE}/checkin/event/${encodeURIComponent(eventId)}`);
        if (response.ok) value = (await response.json()) as EventTrust;
      } catch {
        // treat as failure → cached null for TRUST_FAIL_TTL_MS
      }
    }
    try {
      sessionStorage.setItem(
        `${TRUST_CACHE_PREFIX}${eventId}`,
        JSON.stringify({ at: Date.now(), value }),
      );
    } catch {
      // Session storage unavailable — skip caching for this call.
    }
    return value;
  })();
  trustInFlight.set(eventId, promise);
  try {
    return await promise;
  } finally {
    trustInFlight.delete(eventId);
  }
}

export async function fetchUserCheckins(
  sessionToken: string,
): Promise<UserCheckinRecord> {
  const response = await fetch(`${API_BASE}/checkin/user`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) {
    throw new Error(`Check-in history fetch failed (${response.status})`);
  }
  const body = (await response.json()) as { checkins?: UserCheckinRecord };
  return body.checkins ?? {};
}

/** Ranking boost for the personalized feed: ±10 at the extremes, 0 at 50%. */
export function trustBoost(trustScore: number | null): number {
  if (trustScore == null) return 0;
  return Math.round((trustScore - 50) / 5);
}
