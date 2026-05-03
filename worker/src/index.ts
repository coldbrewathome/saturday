type Vote = "up" | "down" | "meh";

type StopSummary = {
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

type PollRecord = {
  pollId: string;
  title: string;
  stops: StopSummary[];
  ownerToken: string;
  createdAt: string;
};

type VotesRecord = Record<string, Record<string, Vote>>;

type Tallies = Record<string, { up: number; down: number; meh: number }>;

interface Env {
  POLLS: KVNamespace;
  ALLOWED_ORIGINS: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
}

const VOTE_VALUES: Vote[] = ["up", "down", "meh"];

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,OPTIONS",
    "access-control-allow-headers": "content-type",
    "vary": "origin",
  };
}

function json(
  body: unknown,
  init: ResponseInit = {},
  cors: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "content-type": "application/json",
      ...cors,
      ...(init.headers ?? {}),
    },
  });
}

function tally(stops: StopSummary[], votes: VotesRecord): Tallies {
  const result: Tallies = {};
  for (const stop of stops) {
    result[stop.id] = { up: 0, down: 0, meh: 0 };
  }
  for (const voter of Object.values(votes)) {
    for (const [stopId, choice] of Object.entries(voter)) {
      if (result[stopId]) {
        result[stopId][choice] += 1;
      }
    }
  }
  return result;
}

function isStopSummary(value: unknown): value is StopSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.id === "string" && typeof v.name === "string";
}

function cleanText(value: unknown, max = 240): string {
  return typeof value === "string"
    ? value
        .replace(/<[^>]*>/g, " ")
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, max)
    : "";
}

function cleanStops(value: unknown): StopSummary[] {
  const stops = Array.isArray(value) ? value : [];
  return stops
    .filter(isStopSummary)
    .slice(0, 12)
    .map((stop) => ({
      id: cleanText(stop.id, 120),
      name: cleanText(stop.name, 120),
      neighborhood: cleanText(stop.neighborhood, 80),
      category: cleanText(stop.category, 40),
      cost: cleanText(stop.cost, 20) || undefined,
      transitMinutes:
        typeof stop.transitMinutes === "number" && Number.isFinite(stop.transitMinutes)
          ? Math.round(stop.transitMinutes)
          : undefined,
      mood: cleanText(stop.mood, 120) || undefined,
      groupSize: cleanText(stop.groupSize, 40) || undefined,
      planning: cleanText(stop.planning, 60) || undefined,
      openNow: typeof stop.openNow === "boolean" ? stop.openNow : undefined,
      website: cleanText(stop.website, 200) || undefined,
      sourceUrl: cleanText(stop.sourceUrl, 200) || undefined,
      friendScore:
        typeof stop.friendScore === "number" && Number.isFinite(stop.friendScore)
          ? Math.round(stop.friendScore)
          : undefined,
    }));
}

function outputText(response: any): string {
  const parts = response?.output ?? [];
  for (const item of parts) {
    if (item?.type !== "message") continue;
    for (const content of item.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") {
        return content.text;
      }
    }
  }
  return "";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

async function aiBrief(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.OPENAI_API_KEY) {
    return json({ error: "OPENAI_API_KEY is not configured" }, { status: 501 }, cors);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 }, cors);
  }

  const data = payload as { vibe?: unknown; spots?: unknown };
  const vibe = cleanText(data.vibe, 40) || "balanced";
  const spots = cleanStops(data.spots);
  if (spots.length === 0) {
    return json({ error: "spots required" }, { status: 400 }, cors);
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: env.OPENAI_MODEL || "gpt-5.4",
      store: false,
      reasoning: { effort: "low" },
      text: {
        format: { type: "json_object" },
        verbosity: "low",
      },
      instructions:
        "You are a Bay Area friend-plan assistant. Return only JSON with keys title, summary, rationale, cautions. Use only the provided sanitized spots. Do not invent hours, prices, locations, or availability. Mention uncertainty when hours or websites are missing.",
      input: JSON.stringify({
        vibe,
        task:
          "Choose the best friend plan start, explain the tradeoffs, name a backup, and list source-data cautions. Output JSON.",
        spots,
      }),
      max_output_tokens: 700,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return json(
      { error: `OpenAI request failed (${response.status})`, detail: detail.slice(0, 300) },
      { status: 502 },
      cors,
    );
  }

  const raw = await response.json();
  let parsed: unknown;
  try {
    parsed = JSON.parse(outputText(raw));
  } catch {
    return json({ error: "AI response was not valid JSON" }, { status: 502 }, cors);
  }

  const brief = parsed as {
    title?: unknown;
    summary?: unknown;
    rationale?: unknown;
    cautions?: unknown;
  };

  return json(
    {
      brief: {
        title: cleanText(brief.title, 120) || "AI plan",
        summary: cleanText(brief.summary, 300),
        rationale: isStringArray(brief.rationale)
          ? brief.rationale.map((item) => cleanText(item, 220)).filter(Boolean).slice(0, 4)
          : [],
        cautions: isStringArray(brief.cautions)
          ? brief.cautions.map((item) => cleanText(item, 180)).filter(Boolean).slice(0, 4)
          : [],
      },
      model: env.OPENAI_MODEL || "gpt-5.4",
      generatedAt: new Date().toISOString(),
    },
    { status: 200 },
    cors,
  );
}

function isVote(value: unknown): value is Vote {
  return typeof value === "string" && (VOTE_VALUES as string[]).includes(value);
}

async function createPoll(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 }, cors);
  }
  const data = payload as { title?: unknown; stops?: unknown };
  const title = typeof data.title === "string" ? data.title.slice(0, 200) : "Untitled plan";
  const stopsInput = Array.isArray(data.stops) ? data.stops : [];
  const stops = stopsInput.filter(isStopSummary).slice(0, 25);
  if (stops.length === 0) {
    return json({ error: "plan needs at least one stop" }, { status: 400 }, cors);
  }
  const pollId = crypto.randomUUID().slice(0, 8);
  const ownerToken = crypto.randomUUID();
  const record: PollRecord = {
    pollId,
    title,
    stops,
    ownerToken,
    createdAt: new Date().toISOString(),
  };
  await env.POLLS.put(`poll:${pollId}`, JSON.stringify(record), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
  await env.POLLS.put(`votes:${pollId}`, JSON.stringify({}), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
  return json({ pollId, ownerToken }, { status: 201 }, cors);
}

async function getPoll(
  pollId: string,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const raw = await env.POLLS.get(`poll:${pollId}`);
  if (!raw) {
    return json({ error: "not found" }, { status: 404 }, cors);
  }
  const record = JSON.parse(raw) as PollRecord;
  const votesRaw = (await env.POLLS.get(`votes:${pollId}`)) ?? "{}";
  const votes = JSON.parse(votesRaw) as VotesRecord;
  return json(
    {
      pollId: record.pollId,
      title: record.title,
      stops: record.stops,
      tallies: tally(record.stops, votes),
      voterCount: Object.keys(votes).length,
      createdAt: record.createdAt,
    },
    { status: 200 },
    cors,
  );
}

async function recordVote(
  pollId: string,
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const raw = await env.POLLS.get(`poll:${pollId}`);
  if (!raw) {
    return json({ error: "not found" }, { status: 404 }, cors);
  }
  const record = JSON.parse(raw) as PollRecord;
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 }, cors);
  }
  const data = payload as { voterId?: unknown; votes?: unknown };
  if (typeof data.voterId !== "string" || data.voterId.length === 0 || data.voterId.length > 100) {
    return json({ error: "voterId required" }, { status: 400 }, cors);
  }
  if (!data.votes || typeof data.votes !== "object") {
    return json({ error: "votes required" }, { status: 400 }, cors);
  }
  const validStopIds = new Set(record.stops.map((s) => s.id));
  const cleaned: Record<string, Vote> = {};
  for (const [stopId, choice] of Object.entries(data.votes as Record<string, unknown>)) {
    if (validStopIds.has(stopId) && isVote(choice)) {
      cleaned[stopId] = choice;
    }
  }
  const votesRaw = (await env.POLLS.get(`votes:${pollId}`)) ?? "{}";
  const votes = JSON.parse(votesRaw) as VotesRecord;
  votes[data.voterId] = cleaned;
  await env.POLLS.put(`votes:${pollId}`, JSON.stringify(votes), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
  return json(
    { tallies: tally(record.stops, votes), voterCount: Object.keys(votes).length },
    { status: 200 },
    cors,
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const cors = corsHeaders(env, request.headers.get("origin"));
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: cors });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, "");

    if (path === "/polls" && request.method === "POST") {
      return createPoll(request, env, cors);
    }

    if (path === "/ai/brief" && request.method === "POST") {
      return aiBrief(request, env, cors);
    }

    const pollMatch = path.match(/^\/polls\/([A-Za-z0-9-]+)$/);
    if (pollMatch && request.method === "GET") {
      return getPoll(pollMatch[1], env, cors);
    }

    const voteMatch = path.match(/^\/polls\/([A-Za-z0-9-]+)\/votes$/);
    if (voteMatch && request.method === "POST") {
      return recordVote(voteMatch[1], request, env, cors);
    }

    return json({ error: "not found" }, { status: 404 }, cors);
  },
} satisfies ExportedHandler<Env>;
