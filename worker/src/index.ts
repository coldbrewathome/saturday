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
  GOOGLE_CLIENT_ID?: string;
  AI_DAILY_LIMIT_PER_IP?: string;
  POLLS_DAILY_LIMIT_PER_IP?: string;
}

type SessionData = {
  sub: string;
  email: string;
  name: string;
  picture?: string;
  createdAt: string;
};

const VOTE_VALUES: Vote[] = ["up", "down", "meh"];

function corsHeaders(env: Env, origin: string | null): Record<string, string> {
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  const allow = origin && allowed.includes(origin) ? origin : allowed[0] ?? "*";
  return {
    "access-control-allow-origin": allow,
    "access-control-allow-methods": "GET,POST,PUT,OPTIONS",
    "access-control-allow-headers": "content-type,authorization",
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

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const RATE_LIMIT_TTL_SECONDS = 60 * 60 * 25;

async function getSession(
  env: Env,
  request: Request,
): Promise<{ token: string; data: SessionData } | null> {
  const auth = request.headers.get("authorization") || "";
  const match = auth.match(/^Bearer (.+)$/i);
  if (!match) return null;
  const token = match[1].trim();
  if (!token) return null;
  const raw = await env.POLLS.get(`session:${token}`);
  if (!raw) return null;
  return { token, data: JSON.parse(raw) as SessionData };
}

async function createSession(
  env: Env,
  profile: { sub: string; email: string; name: string; picture?: string },
): Promise<string> {
  const token = `${crypto.randomUUID()}${crypto.randomUUID().replace(/-/g, "")}`;
  const data: SessionData = {
    sub: profile.sub,
    email: profile.email,
    name: profile.name,
    picture: profile.picture,
    createdAt: new Date().toISOString(),
  };
  await env.POLLS.put(`session:${token}`, JSON.stringify(data), {
    expirationTtl: SESSION_TTL_SECONDS,
  });
  return token;
}

async function googleAuth(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  if (!env.GOOGLE_CLIENT_ID) {
    return json({ error: "GOOGLE_CLIENT_ID is not configured" }, { status: 501 }, cors);
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 }, cors);
  }
  const data = payload as { idToken?: unknown };
  const idToken = typeof data.idToken === "string" ? data.idToken : "";
  if (!idToken || idToken.length > 4096) {
    return json({ error: "idToken required" }, { status: 400 }, cors);
  }

  const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
  const verify = await fetch(verifyUrl);
  if (!verify.ok) {
    return json({ error: "token verification failed" }, { status: 401 }, cors);
  }
  const claims = (await verify.json()) as {
    sub?: string;
    email?: string;
    email_verified?: string | boolean;
    name?: string;
    picture?: string;
    aud?: string;
    exp?: string;
    iss?: string;
  };

  if (claims.aud !== env.GOOGLE_CLIENT_ID) {
    return json({ error: "audience mismatch" }, { status: 401 }, cors);
  }
  if (claims.iss !== "accounts.google.com" && claims.iss !== "https://accounts.google.com") {
    return json({ error: "issuer mismatch" }, { status: 401 }, cors);
  }
  if (claims.exp && Number(claims.exp) * 1000 < Date.now()) {
    return json({ error: "token expired" }, { status: 401 }, cors);
  }
  const verified =
    claims.email_verified === true || claims.email_verified === "true";
  if (!verified) {
    return json({ error: "email not verified" }, { status: 401 }, cors);
  }
  if (!claims.sub || !claims.email) {
    return json({ error: "missing claims" }, { status: 401 }, cors);
  }

  const token = await createSession(env, {
    sub: claims.sub,
    email: claims.email,
    name: claims.name || claims.email,
    picture: claims.picture,
  });
  return json(
    {
      sessionToken: token,
      user: {
        email: claims.email,
        name: claims.name || claims.email,
        picture: claims.picture,
      },
    },
    { status: 201 },
    cors,
  );
}

async function logout(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const session = await getSession(env, request);
  if (session) {
    await env.POLLS.delete(`session:${session.token}`);
  }
  return json({ ok: true }, { status: 200 }, cors);
}

const USER_STATE_TTL_SECONDS = 60 * 60 * 24 * 365;
const USER_STATE_MAX_BYTES = 200_000;

async function getUserState(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const session = await getSession(env, request);
  if (!session) {
    return json({ error: "sign in required" }, { status: 401 }, cors);
  }
  const raw = await env.POLLS.get(`userstate:${session.data.sub}`);
  return json(
    { state: raw ? JSON.parse(raw) : null },
    { status: 200 },
    cors,
  );
}

async function putUserState(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const session = await getSession(env, request);
  if (!session) {
    return json({ error: "sign in required" }, { status: 401 }, cors);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 }, cors);
  }
  const data = payload as {
    savedIds?: unknown;
    visitedIds?: unknown;
    customSpots?: unknown;
    plans?: unknown;
  };
  const stringArr = (value: unknown, max: number): string[] =>
    Array.isArray(value)
      ? value.filter((v) => typeof v === "string").slice(0, max)
      : [];
  const objectArr = (value: unknown, max: number): unknown[] =>
    Array.isArray(value)
      ? value.filter((v) => v && typeof v === "object").slice(0, max)
      : [];
  const state = {
    savedIds: stringArr(data.savedIds, 500),
    visitedIds: stringArr(data.visitedIds, 1000),
    customSpots: objectArr(data.customSpots, 100),
    plans: objectArr(data.plans, 50),
    updatedAt: new Date().toISOString(),
  };
  const serialized = JSON.stringify(state);
  if (serialized.length > USER_STATE_MAX_BYTES) {
    return json({ error: "state too large" }, { status: 413 }, cors);
  }
  await env.POLLS.put(`userstate:${session.data.sub}`, serialized, {
    expirationTtl: USER_STATE_TTL_SECONDS,
  });
  return json({ ok: true, updatedAt: state.updatedAt }, { status: 200 }, cors);
}

async function checkAndIncrementAiCap(
  request: Request,
  env: Env,
): Promise<{ ok: true } | { ok: false; remaining: 0; limit: number }> {
  return checkAndIncrementCap(request, env, "ai", Number(env.AI_DAILY_LIMIT_PER_IP || "10") || 10);
}

async function checkAndIncrementPollsCap(
  request: Request,
  env: Env,
): Promise<{ ok: true } | { ok: false; remaining: 0; limit: number }> {
  return checkAndIncrementCap(
    request,
    env,
    "polls",
    Number(env.POLLS_DAILY_LIMIT_PER_IP || "30") || 30,
  );
}

async function checkAndIncrementCap(
  request: Request,
  env: Env,
  bucket: string,
  limit: number,
): Promise<{ ok: true } | { ok: false; remaining: 0; limit: number }> {
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const day = new Date().toISOString().slice(0, 10);
  const key = `ratelimit:${bucket}:${ip}:${day}`;
  const raw = await env.POLLS.get(key);
  const count = raw ? Number(raw) : 0;
  if (count >= limit) {
    return { ok: false, remaining: 0, limit };
  }
  await env.POLLS.put(key, String(count + 1), {
    expirationTtl: RATE_LIMIT_TTL_SECONDS,
  });
  return { ok: true };
}

async function aiBrief(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const session = await getSession(env, request);
  if (!session) {
    return json({ error: "sign in required" }, { status: 401 }, cors);
  }

  const cap = await checkAndIncrementAiCap(request, env);
  if (!cap.ok) {
    return json(
      {
        error: `Daily limit reached (${cap.limit} per IP). Try again tomorrow.`,
      },
      { status: 429 },
      cors,
    );
  }

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
        "You are a Bay Area friend-plan assistant. Build a 2-4 stop Saturday plan from the provided sanitized spots. Return only JSON with keys: title (short), summary (1-2 sentences), rationale (array of 2-4 strings), cautions (array of strings about source-data uncertainty), picks (array of {id, reason} ordered as the plan should be done; ids must come from the provided spots; 2-4 picks). Do not invent hours, prices, locations, or availability. Mention uncertainty in cautions when hours or websites are missing.",
      input: JSON.stringify({
        vibe,
        task:
          "Build the Saturday plan: choose 2-4 stops in order, give a brief title and summary, explain the tradeoffs in rationale, list source-data cautions, and return picks with the ordered stop ids. Output JSON only.",
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
    picks?: unknown;
  };

  const validIds = new Set(spots.map((s) => s.id));
  const picksRaw = Array.isArray(brief.picks) ? brief.picks : [];
  const picks: Array<{ id: string; reason: string }> = [];
  const seen = new Set<string>();
  for (const item of picksRaw) {
    if (!item || typeof item !== "object") continue;
    const v = item as Record<string, unknown>;
    const id = typeof v.id === "string" ? v.id : "";
    if (!validIds.has(id) || seen.has(id)) continue;
    seen.add(id);
    picks.push({ id, reason: cleanText(v.reason, 200) });
    if (picks.length >= 4) break;
  }

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
      picks,
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
  const cap = await checkAndIncrementPollsCap(request, env);
  if (!cap.ok) {
    return json(
      { error: `Daily share limit reached (${cap.limit} per IP). Try again tomorrow.` },
      { status: 429 },
      cors,
    );
  }

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

    if (path === "/auth/google" && request.method === "POST") {
      return googleAuth(request, env, cors);
    }

    if (path === "/auth/logout" && request.method === "POST") {
      return logout(request, env, cors);
    }

    if (path === "/me/state" && request.method === "GET") {
      return getUserState(request, env, cors);
    }

    if (path === "/me/state" && request.method === "PUT") {
      return putUserState(request, env, cors);
    }

    if (path === "/geo" && request.method === "GET") {
      const cf = (request as unknown as { cf?: Record<string, unknown> }).cf ?? {};
      const lat = typeof cf.latitude === "string" ? Number(cf.latitude) : null;
      const lon = typeof cf.longitude === "string" ? Number(cf.longitude) : null;
      return json(
        {
          city: typeof cf.city === "string" ? cf.city : null,
          region: typeof cf.region === "string" ? cf.region : null,
          country: typeof cf.country === "string" ? cf.country : null,
          lat: Number.isFinite(lat) ? lat : null,
          lon: Number.isFinite(lon) ? lon : null,
        },
        { status: 200 },
        cors,
      );
    }

    if (path === "/auth/me" && request.method === "GET") {
      const session = await getSession(env, request);
      return json(
        session
          ? {
              user: {
                email: session.data.email,
                name: session.data.name,
                picture: session.data.picture,
              },
            }
          : { user: null },
        { status: 200 },
        cors,
      );
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
