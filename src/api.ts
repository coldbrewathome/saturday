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

function requireApi(): string {
  if (!API_BASE) {
    throw new Error("Voting API is not configured. Set VITE_POLLS_API.");
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

export async function createAiBrief(body: {
  vibe: string;
  spots: StopSummary[];
}): Promise<AiBriefResponse> {
  const response = await fetch(`${requireApi()}/ai/brief`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(`AI brief failed (${response.status})`);
  }
  return response.json();
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
