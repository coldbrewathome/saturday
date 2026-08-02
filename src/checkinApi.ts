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

export async function fetchEventTrust(
  eventId: string,
): Promise<EventTrust | null> {
  if (!API_BASE) return null;
  try {
    const response = await fetch(`${API_BASE}/checkin/event/${encodeURIComponent(eventId)}`);
    if (!response.ok) return null;
    return (await response.json()) as EventTrust;
  } catch {
    return null;
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
