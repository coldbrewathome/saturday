import {
  sendWeekendDigest,
  unsubscribeToken,
  type NewsletterRecipient,
} from "./newsletter";

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

type EventSummary = {
  id: string;
  title: string;
  venue: string;
  city: string;
  startDateTime?: string;
  timeWindow?: string;
  url?: string;
  category?: string;
  cost?: string;
};

type ItemOrderRef = { kind: "spot" | "event"; id: string };

type PollRecord = {
  pollId: string;
  metroId?: string;
  title: string;
  stops: StopSummary[];
  events?: EventSummary[];
  itemOrder?: ItemOrderRef[];
  ownerToken: string;
  createdAt: string;
  // Owner's email for vote notifications. Privacy: never returned by any
  // GET/read response — only used server-side to send the notify email.
  notifyEmail?: string;
};

type NewsletterRecord = {
  email: string;
  metroId: string;
  ageBand?: string;
  source?: string;
  url?: string;
  createdAt: string;
  updatedAt: string;
};

type VotesRecord = Record<string, Record<string, Vote>>;

type Tallies = Record<string, { up: number; down: number; meh: number }>;

interface Env {
  POLLS: KVNamespace;
  ALLOWED_ORIGINS: string;
  OPENAI_API_KEY?: string;
  OPENAI_MODEL?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_ID_ADULTS?: string;
  AI_DAILY_LIMIT_PER_IP?: string;
  POLLS_DAILY_LIMIT_PER_IP?: string;
  ADMIN_EMAILS?: string;
  NEWSLETTER_ADMIN_TOKEN?: string;
  NEWSLETTER_ENABLED?: string;
  RESEND_API_KEY?: string;
  NEWSLETTER_TEST_ALLOWLIST?: string;
  UNSUBSCRIBE_SECRET?: string;
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
    "access-control-allow-methods": "GET,POST,PUT,DELETE,OPTIONS",
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

function tally(
  stops: StopSummary[],
  events: EventSummary[],
  votes: VotesRecord,
): Tallies {
  const result: Tallies = {};
  for (const stop of stops) {
    result[stop.id] = { up: 0, down: 0, meh: 0 };
  }
  for (const event of events) {
    result[event.id] = { up: 0, down: 0, meh: 0 };
  }
  for (const voter of Object.values(votes)) {
    for (const [itemId, choice] of Object.entries(voter)) {
      if (result[itemId]) {
        result[itemId][choice] += 1;
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

function cleanEmail(value: unknown): string {
  const email = cleanText(value, 254).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function safeKvSegment(value: string): string {
  return encodeURIComponent(value).slice(0, 260);
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

function isEventSummary(value: unknown): value is EventSummary {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.id === "string" &&
    typeof v.title === "string" &&
    typeof v.venue === "string" &&
    typeof v.city === "string"
  );
}

function cleanEvents(value: unknown): EventSummary[] {
  const events = Array.isArray(value) ? value : [];
  return events
    .filter(isEventSummary)
    .slice(0, 12)
    .map((event) => ({
      id: cleanText(event.id, 200),
      title: cleanText(event.title, 200),
      venue: cleanText(event.venue, 200),
      city: cleanText(event.city, 100),
      startDateTime: cleanText(event.startDateTime, 40) || undefined,
      timeWindow: cleanText(event.timeWindow, 40) || undefined,
      url: cleanText(event.url, 500) || undefined,
      category: cleanText(event.category, 80) || undefined,
      cost: cleanText(event.cost, 80) || undefined,
    }));
}

function cleanItemOrder(
  value: unknown,
  validIds: { spots: Set<string>; events: Set<string> },
): ItemOrderRef[] {
  const arr = Array.isArray(value) ? value : [];
  const out: ItemOrderRef[] = [];
  const seen = new Set<string>();
  for (const raw of arr) {
    if (!raw || typeof raw !== "object") continue;
    const ref = raw as Record<string, unknown>;
    const kind = ref.kind === "spot" || ref.kind === "event" ? ref.kind : null;
    const id = typeof ref.id === "string" ? ref.id.slice(0, 200) : null;
    if (!kind || !id) continue;
    const key = `${kind}:${id}`;
    if (seen.has(key)) continue;
    if (kind === "spot" && !validIds.spots.has(id)) continue;
    if (kind === "event" && !validIds.events.has(id)) continue;
    seen.add(key);
    out.push({ kind, id });
    if (out.length >= 25) break;
  }
  return out;
}

function cleanPlannerProfile(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const allowed = [
    "transportMode",
    "budget",
    "planLength",
    "crowdTolerance",
    "setting",
  ];
  const result: Record<string, string> = {};
  for (const key of allowed) {
    const cleaned = cleanText(input[key], 40);
    if (cleaned) result[key] = cleaned;
  }
  return Object.keys(result).length > 0 ? result : undefined;
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
  // FamHop (kids) and Mosey (adults) each ship with their own Google OAuth
  // client so the consent screen shows the right brand, so accept either
  // audience here.
  const allowedAudiences = [env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_ID_ADULTS]
    .filter((id): id is string => Boolean(id));
  if (allowedAudiences.length === 0) {
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

  if (!claims.aud || !allowedAudiences.includes(claims.aud)) {
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
const EVENTS_MAX_BYTES = 1_000_000;
const EVENTS_KV_KEY = "admin:events";
const METRO_IDS = new Set([
  "bay-area",
  "los-angeles",
  "new-york-city",
  "seattle",
  "chicago",
  "dallas-fort-worth",
  "houston",
  "washington-dc",
  "atlanta",
  "philadelphia",
  "miami",
  "phoenix",
  "boston",
  "san-diego",
]);

const METRO_ALIASES = new Map([
  ["bayarea", "bay-area"],
  ["losangeles", "los-angeles"],
  ["la", "los-angeles"],
  ["nyc", "new-york-city"],
  ["newyorkcity", "new-york-city"],
  ["new-york", "new-york-city"],
  ["newyork", "new-york-city"],
  ["dfw", "dallas-fort-worth"],
  ["dallas", "dallas-fort-worth"],
  ["fort-worth", "dallas-fort-worth"],
  ["dc", "washington-dc"],
  ["dmv", "washington-dc"],
  ["washington", "washington-dc"],
  ["philly", "philadelphia"],
  ["south-florida", "miami"],
  ["sandiego", "san-diego"],
]);

function normalizeMetroId(raw: string | null | undefined): string | null {
  const normalized = String(raw || "bay-area")
    .toLowerCase()
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[\s_]+/g, "-");
  const canonical = METRO_ALIASES.get(normalized) || normalized;
  return METRO_IDS.has(canonical) ? canonical : null;
}

function metroFromRequest(request: Request): string | null {
  const url = new URL(request.url);
  return normalizeMetroId(url.searchParams.get("metro"));
}

function eventsKvKey(metroId: string): string {
  return metroId === "bay-area" ? EVENTS_KV_KEY : `${EVENTS_KV_KEY}:${metroId}`;
}

function isAdmin(env: Env, email: string | undefined): boolean {
  if (!email || !env.ADMIN_EMAILS) return false;
  const allow = env.ADMIN_EMAILS.split(",").map((s) => s.trim().toLowerCase());
  return allow.includes(email.toLowerCase());
}

async function getEvents(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const metroId = metroFromRequest(request);
  if (!metroId) return json({ error: "invalid metro" }, { status: 400 }, cors);
  const raw = await env.POLLS.get(eventsKvKey(metroId));
  if (!raw) {
    return json({ source: "fallback", events: null }, { status: 200 }, cors);
  }
  return new Response(raw, {
    status: 200,
    headers: {
      "content-type": "application/json",
      ...cors,
    },
  });
}

async function putAdminEvents(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const metroId = metroFromRequest(request);
  if (!metroId) return json({ error: "invalid metro" }, { status: 400 }, cors);
  const session = await getSession(env, request);
  if (!session) {
    return json({ error: "sign in required" }, { status: 401 }, cors);
  }
  if (!isAdmin(env, session.data.email)) {
    return json({ error: "admin access required" }, { status: 403 }, cors);
  }
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid json" }, { status: 400 }, cors);
  }
  if (!payload || typeof payload !== "object") {
    return json({ error: "events object required" }, { status: 400 }, cors);
  }
  const data = payload as { events?: unknown };
  if (!Array.isArray(data.events)) {
    return json({ error: "events array required" }, { status: 400 }, cors);
  }
  const body = JSON.stringify({
    schemaVersion: 1,
    metroId,
    generatedAt: new Date().toISOString(),
    events: data.events,
    source: "admin",
  });
  if (body.length > EVENTS_MAX_BYTES) {
    return json({ error: "events payload too large" }, { status: 413 }, cors);
  }
  await env.POLLS.put(eventsKvKey(metroId), body);
  return json(
    { ok: true, count: data.events.length, bytes: body.length },
    { status: 200 },
    cors,
  );
}

async function deleteAdminEvents(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const metroId = metroFromRequest(request);
  if (!metroId) return json({ error: "invalid metro" }, { status: 400 }, cors);
  const session = await getSession(env, request);
  if (!session) {
    return json({ error: "sign in required" }, { status: 401 }, cors);
  }
  if (!isAdmin(env, session.data.email)) {
    return json({ error: "admin access required" }, { status: 403 }, cors);
  }
  await env.POLLS.delete(eventsKvKey(metroId));
  return json({ ok: true }, { status: 200 }, cors);
}

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
    savedEventIds?: unknown;
    visitedIds?: unknown;
    customSpots?: unknown;
    plans?: unknown;
    deletedPlanIds?: unknown;
    interests?: unknown;
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
    savedEventIds: stringArr(data.savedEventIds, 500),
    visitedIds: stringArr(data.visitedIds, 1000),
    customSpots: objectArr(data.customSpots, 100),
    plans: objectArr(data.plans, 50),
    deletedPlanIds: stringArr(data.deletedPlanIds, 500),
    interests: stringArr(data.interests, 50),
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

  const data = payload as {
    vibe?: unknown;
    spots?: unknown;
    audience?: unknown;
    ageBand?: unknown;
    date?: unknown;
    dayOfWeek?: unknown;
    weather?: unknown;
    preferences?: unknown;
    profile?: unknown;
  };
  const vibe = cleanText(data.vibe, 40) || "balanced";
  const audience = cleanText(data.audience, 10) || "kids";
  const ageBand = cleanText(data.ageBand, 40) || "";
  const date = cleanText(data.date, 12) || "";
  const dayOfWeek = cleanText(data.dayOfWeek, 12) || "";
  const weather =
    data.weather && typeof data.weather === "object" ? data.weather : undefined;
  const preferences = Array.isArray(data.preferences)
    ? data.preferences
        .filter((p): p is string => typeof p === "string")
        .map((p) => cleanText(p, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const profile = cleanPlannerProfile(data.profile);
  const spots = cleanStops(data.spots);
  if (spots.length === 0) {
    return json({ error: "spots required" }, { status: 400 }, cors);
  }

  const isAdults = audience === "adults";
  const instructions = isAdults
    ? "You are a nightlife plan assistant helping friends plan a night out. Build a 2-4 stop evening/night plan from the provided spots. Favor bars, cocktail lounges, live music venues, comedy clubs, breweries, late-night restaurants, and entertainment spots (bowling, escape rooms, karaoke). Some candidates may be scheduled events (concerts, comedy shows, DJ sets); for those, treat the date/time as fixed. GEOGRAPHIC CONSTRAINT: all picks must be near each other — same neighborhood or adjacent area, ideally within 4 miles between any two stops so the crew can walk or take a short ride. Do NOT chain stops in distant areas. When in doubt, prefer fewer stops in one tight cluster. Return only JSON with keys: title (short, fun — e.g. 'Cocktails & Comedy in the Mission'), summary (1-2 sentences for the group organizer), rationale (array of 2-4 strings, each citing why the choice fits the vibe and noting the cluster neighborhood), cautions (array of strings about hours uncertainty, cover charges, reservations needed, or capacity limits), picks (array of {id, reason} ordered as the night should flow; ids must come from the provided spots; 2-4 picks). Do not invent hours, prices, or availability. Mention uncertainty in cautions when info is missing."
    : "You are a Bay Area family-plan assistant for parents planning the weekend with their kids. Build a 2-4 stop kid-friendly weekend plan from the provided sanitized spots. Some candidates may be scheduled family events rather than general venues; for those, treat the date/time in mood/planning as fixed and mention the timing in rationale or cautions. NEVER include bars, breweries, or adult-only venues. Favor parks, libraries, museums, family restaurants, scheduled family events, and active indoor places (bowling, mini-golf, escape rooms appropriate for the age). GEOGRAPHIC CONSTRAINT: all picks must be near each other — same city or one adjacent neighborhood, ideally within 6 miles between any two stops. Do NOT chain stops in distant cities (e.g., Sunnyvale → SF → Sunnyvale is forbidden — that would be 90+ minutes of driving with kids). When in doubt, prefer fewer stops in one tight cluster over more stops spread out. Return only JSON with keys: title (short), summary (1-2 sentences for the parent), rationale (array of 2-4 strings, each citing why the choice fits kids of the given age and noting the cluster city/neighborhood), cautions (array of strings about source-data uncertainty, scheduled-event timing, AND any age-appropriateness caveats), picks (array of {id, reason} ordered as the plan should be done; ids must come from the provided spots; 2-4 picks). Do not invent hours, prices, locations, event times, or availability. Mention uncertainty in cautions when hours or websites are missing.";

  const task = isAdults
    ? "Build a night-out plan for the date above: choose 2-4 stops in order, give a fun title and summary aimed at the group organizer, explain the tradeoffs in rationale (mention the vibe, weather, and preferences when relevant), list cautions, and return picks with the ordered stop ids. If weather is rainy, lean toward indoor venues. Honor each item in 'preferences' and groupProfile as constraints. Make each pick reason specific — matched because X, Y, and Z. Make the picks flow naturally as a night progresses (e.g. dinner → drinks → music → late-night bite). Output JSON only."
    : "Build a kid-friendly weekend plan for the date above: choose 2-4 stops in order, give a brief title and summary aimed at the parent, explain the tradeoffs in rationale (mention age-fit explicitly, AND mention the weather, family preferences, and familyProfile when relevant), list source-data cautions, and return picks with the ordered stop ids. If weather has high precipChance or label is Rainy/Showers/Stormy, lean indoor (Museum, Library, Wellness). Honor each item in 'preferences' and familyProfile as constraints. Make each pick reason specific enough to read as: matched because X, Y, and Z. Make the picks feel different from a generic suggestion — use the day-of-week and shuffled candidate ordering to vary your choice. Output JSON only.";

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
      instructions,
      input: JSON.stringify({
        vibe,
        ...(isAdults ? {} : { ageBand: ageBand || "mixed ages" }),
        today: date,
        dayOfWeek,
        weather,
        preferences,
        ...(isAdults ? { groupProfile: profile } : { familyProfile: profile }),
        task,
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

function weatherCodeLabel(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Mostly sunny";
  if (code === 3) return "Cloudy";
  if (code === 45 || code === 48) return "Foggy";
  if (code >= 51 && code <= 57) return "Drizzly";
  if (code >= 61 && code <= 67) return "Rainy";
  if (code >= 71 && code <= 86) return "Snowy";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Stormy";
  return "Mixed";
}

async function getWeather(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  const lat = parseFloat(url.searchParams.get("lat") || "");
  const lon = parseFloat(url.searchParams.get("lon") || "");
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    return json({ error: "lat,lon required" }, { status: 400 }, cors);
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  const cacheKey = `weather:${round(lat)},${round(lon)}`;
  const cached = await env.POLLS.get(cacheKey);
  if (cached) {
    return new Response(cached, {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-cache": "HIT",
        ...cors,
      },
    });
  }

  const apiUrl =
    `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
    `&daily=weathercode,temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
    `&timezone=auto&forecast_days=10&temperature_unit=fahrenheit`;
  const response = await fetch(apiUrl, {
    headers: { "User-Agent": "famhop/0.1" },
  });
  if (!response.ok) {
    return json({ error: "weather lookup failed" }, { status: 502 }, cors);
  }
  const data = (await response.json()) as {
    daily?: {
      time?: string[];
      weathercode?: number[];
      temperature_2m_max?: number[];
      temperature_2m_min?: number[];
      precipitation_probability_max?: number[];
    };
  };
  const daily = data.daily;
  if (!daily || !Array.isArray(daily.time)) {
    return json({ error: "weather format unexpected" }, { status: 502 }, cors);
  }

  type Day = {
    date: string;
    weatherCode: number;
    label: string;
    tempMaxF: number;
    tempMinF: number;
    precipChance: number;
  };
  let saturday: Day | null = null;
  let sunday: Day | null = null;
  for (let i = 0; i < daily.time.length; i += 1) {
    const date = new Date(`${daily.time[i]}T12:00:00`);
    const dow = date.getDay();
    const code = daily.weathercode?.[i] ?? -1;
    const entry: Day = {
      date: daily.time[i],
      weatherCode: code,
      label: weatherCodeLabel(code),
      tempMaxF: Math.round(daily.temperature_2m_max?.[i] ?? 0),
      tempMinF: Math.round(daily.temperature_2m_min?.[i] ?? 0),
      precipChance: daily.precipitation_probability_max?.[i] ?? 0,
    };
    if (dow === 6 && !saturday) saturday = entry;
    if (dow === 0 && !sunday) sunday = entry;
    if (saturday && sunday) break;
  }

  const body = JSON.stringify({
    saturday,
    sunday,
    fetchedAt: new Date().toISOString(),
  });
  await env.POLLS.put(cacheKey, body, { expirationTtl: 60 * 60 });
  return new Response(body, {
    status: 200,
    headers: {
      "content-type": "application/json",
      "x-cache": "MISS",
      ...cors,
    },
  });
}

async function aiSwap(
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
      { error: `Daily limit reached (${cap.limit} per IP). Try again tomorrow.` },
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
  const data = payload as {
    vibe?: unknown;
    audience?: unknown;
    ageBand?: unknown;
    date?: unknown;
    dayOfWeek?: unknown;
    currentPicks?: unknown;
    replaceStopId?: unknown;
    candidates?: unknown;
    weather?: unknown;
    preferences?: unknown;
    profile?: unknown;
  };
  const vibe = cleanText(data.vibe, 40) || "balanced";
  const audience = cleanText(data.audience, 10) || "kids";
  const isAdults = audience === "adults";
  const ageBand = cleanText(data.ageBand, 40) || "";
  const date = cleanText(data.date, 12) || "";
  const dayOfWeek = cleanText(data.dayOfWeek, 12) || "";
  const replaceStopId = cleanText(data.replaceStopId, 120);
  const weather =
    data.weather && typeof data.weather === "object" ? data.weather : undefined;
  const preferences = Array.isArray(data.preferences)
    ? data.preferences
        .filter((p): p is string => typeof p === "string")
        .map((p) => cleanText(p, 40))
        .filter(Boolean)
        .slice(0, 8)
    : [];
  const profile = cleanPlannerProfile(data.profile);
  if (!replaceStopId) {
    return json({ error: "replaceStopId required" }, { status: 400 }, cors);
  }
  const currentPicks = cleanStops(data.currentPicks);
  const candidates = cleanStops(data.candidates);
  if (candidates.length === 0) {
    return json({ error: "candidates required" }, { status: 400 }, cors);
  }

  const swapInstructions = isAdults
    ? "You are a nightlife plan assistant. Replace ONE stop in an existing night-out plan with a better-fitting alternative from the provided candidates. Some candidates may be scheduled events (concerts, DJ sets, comedy shows); for those, treat the time as fixed. NEVER pick a candidate whose id already appears in currentPicks. Pick should be GEOGRAPHICALLY CLOSE to the other stops — same neighborhood, ideally within 4 miles. Return only JSON {pick: {id, reason}} where reason is one short sentence for the crew."
    : "You are a Bay Area family-plan assistant. Replace ONE stop in an existing kid-friendly plan with a better-fitting alternative from the provided candidates. Some candidates may be scheduled family events rather than general venues; for those, treat the date/time in mood/planning as fixed. NEVER pick a candidate whose id already appears in currentPicks. Pick should be GEOGRAPHICALLY CLOSE to the other stops in currentPicks — same city or adjacent neighborhood, ideally within 5 miles. Stay age-appropriate. Return only JSON {pick: {id, reason}} where reason is one short sentence for the parent.";

  const swapTask = isAdults
    ? "Pick one candidate to replace the stop with id=replaceStopId in currentPicks. Reject any candidate whose id appears in currentPicks. Honor 'preferences' and groupProfile as constraints. If weather is rainy, lean indoor. Make the reason specific — matched because X, Y, and Z. Output JSON {pick: {id, reason}} only."
    : "Pick one candidate to replace the stop with id=replaceStopId in currentPicks. Reject any candidate whose id appears in currentPicks. Honor 'preferences' and familyProfile as constraints. If weather is rainy/stormy, lean indoor. Make the reason specific enough to read as: matched because X, Y, and Z. Output JSON {pick: {id, reason}} only.";

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
      instructions: swapInstructions,
      input: JSON.stringify({
        vibe,
        ...(isAdults ? {} : { ageBand: ageBand || "mixed ages" }),
        today: date,
        dayOfWeek,
        weather,
        preferences,
        ...(isAdults ? { groupProfile: profile } : { familyProfile: profile }),
        currentPicks,
        replaceStopId,
        candidates,
        task: swapTask,
      }),
      max_output_tokens: 300,
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
  const pickRaw = (parsed as { pick?: { id?: unknown; reason?: unknown } }).pick;
  const id = pickRaw && typeof pickRaw.id === "string" ? pickRaw.id : "";
  const usedIds = new Set(currentPicks.map((p) => p.id));
  const validIds = new Set(candidates.map((c) => c.id));
  if (!id || !validIds.has(id) || usedIds.has(id)) {
    return json({ error: "AI returned an invalid pick" }, { status: 502 }, cors);
  }
  return json(
    {
      pick: { id, reason: cleanText(pickRaw?.reason, 200) },
      model: env.OPENAI_MODEL || "gpt-5.4",
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
  const data = payload as {
    title?: unknown;
    metroId?: unknown;
    stops?: unknown;
    events?: unknown;
    itemOrder?: unknown;
    notifyEmail?: unknown;
  };
  const title = typeof data.title === "string" ? data.title.slice(0, 200) : "Untitled plan";
  const notifyEmail = cleanEmail(data.notifyEmail);
  const rawMetroId = typeof data.metroId === "string" ? data.metroId : "bay-area";
  const metroId = normalizeMetroId(rawMetroId) || "bay-area";
  const stopsInput = Array.isArray(data.stops) ? data.stops : [];
  const stops = stopsInput.filter(isStopSummary).slice(0, 25);
  const events = cleanEvents(data.events);
  if (stops.length === 0 && events.length === 0) {
    return json(
      { error: "plan needs at least one place or event" },
      { status: 400 },
      cors,
    );
  }
  const itemOrder = cleanItemOrder(data.itemOrder, {
    spots: new Set(stops.map((s) => s.id)),
    events: new Set(events.map((e) => e.id)),
  });
  const pollId = crypto.randomUUID().slice(0, 8);
  const ownerToken = crypto.randomUUID();
  const record: PollRecord = {
    pollId,
    metroId,
    title,
    stops,
    events: events.length > 0 ? events : undefined,
    itemOrder: itemOrder.length > 0 ? itemOrder : undefined,
    ownerToken,
    createdAt: new Date().toISOString(),
    notifyEmail: notifyEmail || undefined,
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
      metroId: record.metroId || "bay-area",
      title: record.title,
      stops: record.stops,
      events: record.events ?? [],
      tallies: tally(record.stops, record.events ?? [], votes),
      voterCount: Object.keys(votes).length,
      createdAt: record.createdAt,
    },
    { status: 200 },
    cors,
  );
}

// Throttle window for "friends voted on your plan" owner emails.
const VOTE_NOTIFY_THROTTLE_SECONDS = 30 * 60;

function siteOriginForRequest(env: Env, request: Request): string {
  const origin = request.headers.get("origin");
  const allowed = env.ALLOWED_ORIGINS.split(",").map((s) => s.trim());
  return origin && allowed.includes(origin) ? origin : "https://famhop.com";
}

// Fire-and-forget (via ctx.waitUntil) email to the plan owner when a vote
// lands. Throttled to one email per poll per 30 minutes via a KV timestamp.
// Never throws — a notify failure must not affect the vote itself.
async function sendVoteNotification(
  env: Env,
  record: PollRecord,
  voterCount: number,
  siteOrigin: string,
): Promise<void> {
  try {
    const throttleKey = `pollnotify:${record.pollId}`;
    const recent = await env.POLLS.get(throttleKey);
    if (recent) return;
    await env.POLLS.put(throttleKey, new Date().toISOString(), {
      expirationTtl: VOTE_NOTIFY_THROTTLE_SECONDS,
    });
    const pollUrl = `${siteOrigin}/#/p/${record.pollId}`;
    const friends =
      voterCount === 1 ? "1 friend has" : `${voterCount} friends have`;
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.RESEND_API_KEY}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from: "FamHop <weekly@famhop.com>",
        to: [record.notifyEmail],
        subject: `${friends} voted on your plan`,
        text: `${friends} voted on your plan — see results: ${pollUrl}`,
      }),
    });
    if (!res.ok) {
      console.log("[poll-notify] resend failed", { status: res.status });
    }
  } catch (err) {
    console.log("[poll-notify] error", {
      message: err instanceof Error ? err.message : String(err).slice(0, 200),
    });
  }
}

async function recordVote(
  pollId: string,
  request: Request,
  env: Env,
  ctx: ExecutionContext,
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
  const validIds = new Set([
    ...record.stops.map((s) => s.id),
    ...(record.events ?? []).map((e) => e.id),
  ]);
  const cleaned: Record<string, Vote> = {};
  for (const [itemId, choice] of Object.entries(data.votes as Record<string, unknown>)) {
    if (validIds.has(itemId) && isVote(choice)) {
      cleaned[itemId] = choice;
    }
  }
  const votesRaw = (await env.POLLS.get(`votes:${pollId}`)) ?? "{}";
  const votes = JSON.parse(votesRaw) as VotesRecord;
  votes[data.voterId] = cleaned;
  await env.POLLS.put(`votes:${pollId}`, JSON.stringify(votes), {
    expirationTtl: 60 * 60 * 24 * 30,
  });
  const voterCount = Object.keys(votes).length;
  if (
    record.notifyEmail &&
    env.RESEND_API_KEY &&
    env.NEWSLETTER_ENABLED === "true"
  ) {
    ctx.waitUntil(
      sendVoteNotification(
        env,
        record,
        voterCount,
        siteOriginForRequest(env, request),
      ),
    );
  }
  return json(
    {
      tallies: tally(record.stops, record.events ?? [], votes),
      voterCount,
    },
    { status: 200 },
    cors,
  );
}

async function subscribeNewsletter(
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

  const data = payload as {
    email?: unknown;
    metroId?: unknown;
    ageBand?: unknown;
    source?: unknown;
    url?: unknown;
  };
  const email = cleanEmail(data.email);
  if (!email) {
    return json({ error: "valid email required" }, { status: 400 }, cors);
  }

  const metroId = cleanText(data.metroId, 60) || "unknown";
  const ageBand = cleanText(data.ageBand, 40) || undefined;
  const source = cleanText(data.source, 80) || "weekend-guide";
  const url = cleanText(data.url, 500) || undefined;
  const now = new Date().toISOString();
  const key = `newsletter:${safeKvSegment(metroId)}:${safeKvSegment(email)}`;

  let createdAt = now;
  const existingRaw = await env.POLLS.get(key);
  if (existingRaw) {
    try {
      const existing = JSON.parse(existingRaw) as Partial<NewsletterRecord>;
      if (typeof existing.createdAt === "string") createdAt = existing.createdAt;
    } catch {
      // keep a new createdAt if the old value is malformed
    }
  }

  const record: NewsletterRecord = {
    email,
    metroId,
    ageBand,
    source,
    url,
    createdAt,
    updatedAt: now,
  };
  await env.POLLS.put(key, JSON.stringify(record));
  return json({ ok: true }, { status: 200 }, cors);
}

const UNSUBSCRIBED_PAGE = `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width, initial-scale=1"/><title>Unsubscribed</title></head>
<body style="margin:0;padding:48px 24px;background:#f7f5f1;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#222;text-align:center;">
<h1 style="font-size:24px;margin:0 0 8px;">You're unsubscribed.</h1>
<p style="color:#666;margin:0;">You won't get the weekly digest anymore. Changed your mind? Sign up again any time on the site.</p>
</body>
</html>`;

// GET/POST /newsletter/unsubscribe?email=...&token=... where token is the
// hex HMAC-SHA256 of the lowercased email (see unsubscribeToken). POST is
// the RFC 8058 one-click path used by mail clients via List-Unsubscribe-Post.
async function unsubscribeNewsletter(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const url = new URL(request.url);
  const email = cleanEmail(url.searchParams.get("email"));
  const token = cleanText(url.searchParams.get("token"), 128);
  const secret = env.UNSUBSCRIBE_SECRET || env.NEWSLETTER_ADMIN_TOKEN;
  if (!email || !token || !secret) {
    return json({ error: "invalid unsubscribe link" }, { status: 400 }, cors);
  }
  const expected = await unsubscribeToken(email, secret);
  if (token !== expected) {
    return json({ error: "invalid unsubscribe link" }, { status: 400 }, cors);
  }
  // Subscriber records are keyed newsletter:{metro}:{email} and the link
  // only carries the email, so remove the address from every metro list.
  const suffix = `:${safeKvSegment(email)}`;
  let cursor: string | undefined;
  do {
    const list = await env.POLLS.list({ prefix: "newsletter:", cursor });
    for (const k of list.keys) {
      if (k.name.endsWith(suffix)) {
        await env.POLLS.delete(k.name);
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  if (request.method === "POST") {
    return new Response(null, { status: 200, headers: cors });
  }
  return new Response(UNSUBSCRIBED_PAGE, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8", ...cors },
  });
}

async function sendNewsletter(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const token = env.NEWSLETTER_ADMIN_TOKEN;
  if (!token) {
    return json(
      { error: "newsletter sending not configured" },
      { status: 503 },
      cors,
    );
  }
  const auth = request.headers.get("authorization") || "";
  const provided = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!provided || provided !== token) {
    return json({ error: "admin access required" }, { status: 403 }, cors);
  }

  let payload: unknown = null;
  if (request.headers.get("content-type")?.includes("application/json")) {
    try {
      payload = await request.json();
    } catch {
      return json({ error: "invalid json" }, { status: 400 }, cors);
    }
  }
  const data = (payload && typeof payload === "object" ? payload : {}) as {
    recipients?: unknown;
  };
  const rawRecipients = Array.isArray(data.recipients) ? data.recipients : [];
  const recipients: NewsletterRecipient[] = [];
  for (const entry of rawRecipients) {
    if (!entry || typeof entry !== "object") continue;
    const e = entry as { email?: unknown; metroId?: unknown; ageBand?: unknown };
    const email = cleanEmail(e.email);
    if (!email) continue;
    recipients.push({
      email,
      metroId: cleanText(e.metroId, 60) || undefined,
      ageBand: cleanText(e.ageBand, 40) || undefined,
    });
  }

  // Unsubscribe links point back at this worker's own origin.
  const result = await sendWeekendDigest(
    env,
    recipients,
    fetch,
    new URL(request.url).origin,
  );
  return json(result, { status: 200 }, cors);
}

// ── First-party funnel metrics ──────────────────────────────────────────
// Aggregate, no-PII counters keyed by metric:{name}:{metro}:{date}. Used to
// answer "is the share loop / SEO actually working" without third-party
// trackers or cookies (the site is family-facing, so we avoid GA4/PII).
const METRIC_NAMES = new Set([
  "app_open",
  "app_open_return",
  "hero_plan_created",
  "hop_now_opened",
  "plan_created",
  "plan_shared",
  "item_shared",
  "poll_viewed",
  "vote_cast",
  "weekend_guide_click",
  "signin_prompt_shown",
  "signin_prompt_clicked",
  "signin_success",
  "newsletter_subscribed",
  "digest_prompt_shown",
]);
const METRIC_BRANDS = new Set(["famhop", "mosey"]);
const METRIC_TTL_SECONDS = 60 * 60 * 24 * 120; // ~120 days

async function recordMetric(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  // Light per-IP cap so a single client can't inflate or run up KV writes.
  const cap = await checkAndIncrementCap(request, env, "metric", 500);
  if (!cap.ok) return new Response(null, { status: 204, headers: cors });
  const url = new URL(request.url);
  const name = cleanText(url.searchParams.get("name"), 40);
  if (!METRIC_NAMES.has(name)) {
    return new Response(null, { status: 204, headers: cors });
  }
  const metroRaw = cleanText(url.searchParams.get("metro") || "all", 40) || "all";
  const metro = safeKvSegment(metroRaw);
  // Optional JSON body field `brand` ("famhop" | "mosey") adds a per-brand
  // counter under metricb:{name}:{brand}:{day}. Anything else is ignored.
  let brand = "";
  try {
    const body = (await request.json()) as { brand?: unknown };
    if (
      body &&
      typeof body.brand === "string" &&
      METRIC_BRANDS.has(body.brand)
    ) {
      brand = body.brand;
    }
  } catch {
    // no body / invalid json — brand stays unset
  }
  const day = new Date().toISOString().slice(0, 10);
  for (const key of [
    `metric:${name}:all:${day}`,
    `metric:${name}:${metro}:${day}`,
    ...(brand ? [`metricb:${name}:${brand}:${day}`] : []),
  ]) {
    const raw = await env.POLLS.get(key);
    const count = raw ? Number(raw) : 0;
    await env.POLLS.put(key, String(count + 1), {
      expirationTtl: METRIC_TTL_SECONDS,
    });
  }
  return new Response(null, { status: 204, headers: cors });
}

async function readMetrics(
  request: Request,
  env: Env,
  cors: Record<string, string>,
): Promise<Response> {
  const session = await getSession(env, request);
  if (!session) return json({ error: "sign in required" }, { status: 401 }, cors);
  if (!isAdmin(env, session.data.email)) {
    return json({ error: "admin access required" }, { status: 403 }, cors);
  }
  const url = new URL(request.url);
  const days = Math.min(90, Math.max(1, Number(url.searchParams.get("days") || "30") || 30));
  const cutoff = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const totals: Record<string, number> = {};
  const byDay: Record<string, Record<string, number>> = {};
  // Per-metro rollup keyed by real metro id (the `all` bucket is excluded —
  // it's a denormalized sum already exposed via `totals`). Additive to the
  // response per ADR 03 so the analytics dashboard can render the per-metro
  // table without a second request.
  const byMetro: Record<string, Record<string, number>> = {};
  let cursor: string | undefined;
  do {
    const list = await env.POLLS.list({ prefix: "metric:", cursor });
    for (const k of list.keys) {
      const parts = k.name.split(":");
      if (parts.length !== 4) continue;
      const [, name, metro, date] = parts;
      if (date < cutoff) continue;
      const raw = await env.POLLS.get(k.name);
      const count = raw ? Number(raw) : 0;
      if (metro === "all") {
        totals[name] = (totals[name] || 0) + count;
        byDay[date] = byDay[date] || {};
        byDay[date][name] = (byDay[date][name] || 0) + count;
      } else {
        byMetro[metro] = byMetro[metro] || {};
        byMetro[metro][name] = (byMetro[metro][name] || 0) + count;
      }
    }
    cursor = list.list_complete ? undefined : list.cursor;
  } while (cursor);
  // Per-brand rollup from the metricb: prefix (additive — existing response
  // fields are unchanged). name -> { famhop, mosey } over the same window.
  const byBrand: Record<string, { famhop: number; mosey: number }> = {};
  let brandCursor: string | undefined;
  do {
    const list = await env.POLLS.list({ prefix: "metricb:", cursor: brandCursor });
    for (const k of list.keys) {
      const parts = k.name.split(":");
      if (parts.length !== 4) continue;
      const [, name, brand, date] = parts;
      if (date < cutoff) continue;
      if (brand !== "famhop" && brand !== "mosey") continue;
      const raw = await env.POLLS.get(k.name);
      const count = raw ? Number(raw) : 0;
      byBrand[name] = byBrand[name] || { famhop: 0, mosey: 0 };
      byBrand[name][brand] += count;
    }
    brandCursor = list.list_complete ? undefined : list.cursor;
  } while (brandCursor);
  return json({ days, totals, byDay, byMetro, byBrand }, { status: 200 }, cors);
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
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

    if (path === "/ai/swap" && request.method === "POST") {
      return aiSwap(request, env, cors);
    }

    if (path === "/weather" && request.method === "GET") {
      return getWeather(request, env, cors);
    }

    if (path === "/newsletter" && request.method === "POST") {
      return subscribeNewsletter(request, env, cors);
    }

    if (path === "/newsletter/send" && request.method === "POST") {
      return sendNewsletter(request, env, cors);
    }

    if (
      path === "/newsletter/unsubscribe" &&
      (request.method === "GET" || request.method === "POST")
    ) {
      return unsubscribeNewsletter(request, env, cors);
    }

    if (path === "/metric") {
      return recordMetric(request, env, cors);
    }

    if (path === "/metrics" && request.method === "GET") {
      return readMetrics(request, env, cors);
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

    if (path === "/events" && request.method === "GET") {
      return getEvents(request, env, cors);
    }

    if (path === "/admin/events" && request.method === "PUT") {
      return putAdminEvents(request, env, cors);
    }

    if (path === "/admin/events" && request.method === "DELETE") {
      return deleteAdminEvents(request, env, cors);
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
      return recordVote(voteMatch[1], request, env, ctx, cors);
    }

    return json({ error: "not found" }, { status: 404 }, cors);
  },
} satisfies ExportedHandler<Env>;
