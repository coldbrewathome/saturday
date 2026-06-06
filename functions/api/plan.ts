// Public plan endpoint — GET or POST /api/plan
//
// Builds a short itinerary from the shared FamHop/Mosey data feed using the
// same scorer as the app (src/planner.ts via src/planApi.ts), so LLM tools /
// agents can generate real plans instead of guessing.
//
// Params (query string or JSON body):
//   metro     required  metro slug, e.g. "bay-area", "los-angeles"
//   vibe      optional  balanced | low-effort | active | food-first | culture
//   ageBand   optional  toddler | preschool | school-age | tween
//   audience  optional  kids | adults (defaults by host: trymosey -> adults)
//   events    optional  "false" to exclude scheduled events
//   limit     optional  number of stops (1-5, default 3)

import {
  buildPlan,
  isAgeBand,
  isVibe,
  resolveMetro,
  type ApiAudience,
} from "../../src/planApi";
import type { AgeBand, PlannerVibe } from "../../src/planner";
import {
  audienceFor,
  CORS,
  dataOrigin,
  json,
  loadMetroData,
  readParams,
  type ApiEnv,
} from "./_data";

type Context = { request: Request; env: ApiEnv };

export async function onRequest(context: Context): Promise<Response> {
  const { request, env } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }
  if (request.method !== "GET" && request.method !== "POST") {
    return json({ error: "method_not_allowed" }, 405);
  }

  const params = await readParams(request);
  const metro = resolveMetro(params.metro);
  if (!metro) {
    return json(
      { error: "unknown_metro", hint: "Pass a supported metro slug, e.g. bay-area." },
      400,
    );
  }

  const vibe: PlannerVibe = isVibe(params.vibe || "") ? (params.vibe as PlannerVibe) : "balanced";
  const ageBand: AgeBand | undefined = isAgeBand(params.ageBand || "")
    ? (params.ageBand as AgeBand)
    : undefined;
  const audience: ApiAudience = audienceFor(new URL(request.url).hostname, params.audience);
  const includeEvents = params.events !== "false";
  const limit = Number.isFinite(Number(params.limit)) ? Number(params.limit) : 3;

  let spots, events;
  try {
    ({ spots, events } = await loadMetroData(dataOrigin(env), metro, audience));
  } catch {
    return json({ error: "data_unavailable", metro: metro.id }, 502);
  }

  const plan = buildPlan({
    metro,
    spots,
    events,
    vibe,
    audience,
    ageBand,
    includeEvents,
    limit,
  });

  return json(plan, 200, {
    "cache-control": "public, max-age=300, s-maxage=600",
  });
}
