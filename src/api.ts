export type Vote = "up" | "down" | "meh";

export type StopSummary = {
  id: string;
  name: string;
  neighborhood: string;
  category: string;
  imageUrl?: string;
  cost?: string;
  transitMinutes?: number;
  mood?: string;
  groupSize?: string;
  planning?: string;
  openNow?: boolean;
  website?: string | null;
  sourceUrl?: string;
  friendScore?: number;
};

export type AiBriefResponse = {
  brief: {
    title: string;
    summary: string;
    rationale: string[];
    cautions: string[];
  };
  picks: Array<{ id: string; reason: string }>;
  model: string;
  generatedAt: string;
};

export type Tallies = Record<string, { up: number; down: number; meh: number }>;

export type PollSnapshot = {
  pollId: string;
  title: string;
  stops: StopSummary[];
  tallies: Tallies;
  voterCount: number;
  createdAt: string;
};

const API_BASE = (import.meta.env.VITE_POLLS_API ?? "").replace(/\/$/, "");

export const API_CONFIGURED = API_BASE.length > 0;

function requireApi(): string {
  if (!API_BASE) {
    throw new Error("Backend API is not configured.");
  }
  return API_BASE;
}

export async function createPoll(body: {
  title: string;
  stops: StopSummary[];
}): Promise<{ pollId: string; ownerToken: string }> {
  const response = await fetch(`${requireApi()}/polls`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`Create poll failed (${response.status})`);
  }
  return response.json();
}

export async function getPoll(pollId: string): Promise<PollSnapshot> {
  const response = await fetch(`${requireApi()}/polls/${pollId}`);
  if (!response.ok) {
    throw new Error(`Poll not found (${response.status})`);
  }
  return response.json();
}

export async function postVote(
  pollId: string,
  voterId: string,
  votes: Record<string, Vote>,
): Promise<{ tallies: Tallies; voterCount: number }> {
  const response = await fetch(`${requireApi()}/polls/${pollId}/votes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ voterId, votes }),
  });
  if (!response.ok) {
    throw new Error(`Vote failed (${response.status})`);
  }
  return response.json();
}

export async function createAiBrief(
  body: { vibe: string; spots: StopSummary[] },
  sessionToken: string,
): Promise<AiBriefResponse> {
  const response = await fetch(`${requireApi()}/ai/brief`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    let detail = "";
    try {
      const data = (await response.json()) as { error?: string };
      detail = data?.error ? `: ${data.error}` : "";
    } catch {
      // ignore
    }
    throw new Error(`AI brief failed (${response.status})${detail}`);
  }
  return response.json();
}

export type GeoInfo = {
  city: string | null;
  region: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
};

export async function fetchGeo(): Promise<GeoInfo | null> {
  if (!API_BASE) return null;
  try {
    const response = await fetch(`${API_BASE}/geo`);
    if (!response.ok) return null;
    return (await response.json()) as GeoInfo;
  } catch {
    return null;
  }
}

export async function googleSignIn(
  idToken: string,
): Promise<{ sessionToken: string; user: { email: string; name: string; picture?: string } }> {
  const response = await fetch(`${requireApi()}/auth/google`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ idToken }),
  });
  if (!response.ok) {
    throw new Error(`Sign-in failed (${response.status})`);
  }
  return response.json();
}

export type SyncedState = {
  savedIds: string[];
  visitedIds: string[];
  customSpots: unknown[];
  plans: unknown[];
  updatedAt?: string;
};

export async function getUserState(
  sessionToken: string,
): Promise<SyncedState | null> {
  const response = await fetch(`${requireApi()}/me/state`, {
    headers: { authorization: `Bearer ${sessionToken}` },
  });
  if (!response.ok) {
    throw new Error(`State fetch failed (${response.status})`);
  }
  const body = (await response.json()) as { state: SyncedState | null };
  return body.state;
}

export async function putUserState(
  sessionToken: string,
  state: SyncedState,
): Promise<void> {
  const response = await fetch(`${requireApi()}/me/state`, {
    method: "PUT",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${sessionToken}`,
    },
    body: JSON.stringify(state),
  });
  if (!response.ok) {
    throw new Error(`State sync failed (${response.status})`);
  }
}

export async function logoutSession(sessionToken: string): Promise<void> {
  await fetch(`${requireApi()}/auth/logout`, {
    method: "POST",
    headers: { authorization: `Bearer ${sessionToken}` },
  }).catch(() => {});
}

export function getOrCreateVoterId(): string {
  const KEY = "saturday.voterId";
  const existing = window.localStorage.getItem(KEY);
  if (existing) {
    return existing;
  }
  const next = crypto.randomUUID();
  window.localStorage.setItem(KEY, next);
  return next;
}
