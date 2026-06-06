// Public search endpoint — GET or POST /api/search
//
// Looks up places and events from the shared data feed so agents can pull
// real records by keyword.
//
// Params (query string or JSON body):
//   metro     required  metro slug, e.g. "bay-area"
//   q         required  search text
//   type      optional  places | events | all (default all)
//   audience  optional  kids | adults (defaults by host)
//   limit     optional  max hits (1-50, default 20)

import { resolveMetro, searchRecords, type ApiAudience } from "../../src/planApi";
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
  const query = (params.q || "").trim();
  if (!query) {
    return json({ error: "missing_query", hint: "Pass q=<search text>." }, 400);
  }

  const type =
    params.type === "places" || params.type === "events" ? params.type : "all";
  const audience: ApiAudience = audienceFor(new URL(request.url).hostname, params.audience);
  const limit = Number.isFinite(Number(params.limit)) ? Number(params.limit) : 20;

  let spots, events;
  try {
    ({ spots, events } = await loadMetroData(dataOrigin(env), metro, audience));
  } catch {
    return json({ error: "data_unavailable", metro: metro.id }, 502);
  }

  const result = searchRecords({ metro, spots, events, query, type, limit });
  return json(result, 200, {
    "cache-control": "public, max-age=300, s-maxage=600",
  });
}
