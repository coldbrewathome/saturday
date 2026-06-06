// Shared helpers for the public /api Pages Functions. The leading underscore
// keeps this file out of the route table (it is imported, not served).

import type { MetroConfig } from "../../src/metros";
import type { PlannerSpot } from "../../src/planner";
import type { ApiAudience, RawEvent } from "../../src/planApi";

// The shared, CORS-enabled data feed (the standalone famhop-data Pages
// project). Overridable via the DATA_ORIGIN env var for previews/local.
const DEFAULT_DATA_ORIGIN = "https://famhop-data.pages.dev";

export type ApiEnv = { DATA_ORIGIN?: string };

export function dataOrigin(env: ApiEnv | undefined): string {
  const fromEnv = env && env.DATA_ORIGIN ? String(env.DATA_ORIGIN) : "";
  return (fromEnv || DEFAULT_DATA_ORIGIN).replace(/\/$/, "");
}

async function fetchJson(url: string): Promise<unknown> {
  const res = await fetch(url, {
    cf: { cacheTtl: 300, cacheEverything: true },
  } as RequestInit);
  if (!res.ok) throw new Error(`fetch ${url} -> ${res.status}`);
  return res.json();
}

export async function loadMetroData(
  origin: string,
  metro: MetroConfig,
  audience: ApiAudience,
): Promise<{ spots: PlannerSpot[]; events: RawEvent[] }> {
  const spotsFile = audience === "adults" ? "spots-adults.json" : "spots.json";
  const eventsFile = audience === "adults" ? "events-adults.json" : "events.json";
  const base = `${origin}/data/${metro.dataDir}`;

  const [spotsDoc, eventsDoc] = await Promise.all([
    fetchJson(`${base}/${spotsFile}`),
    fetchJson(`${base}/${eventsFile}`).catch(() => ({ events: [] })),
  ]);

  const spots = (
    Array.isArray(spotsDoc)
      ? spotsDoc
      : ((spotsDoc as { spots?: unknown }).spots ?? [])
  ) as PlannerSpot[];
  const events = (
    Array.isArray(eventsDoc)
      ? eventsDoc
      : ((eventsDoc as { events?: unknown }).events ?? [])
  ) as RawEvent[];

  return { spots, events };
}

export const CORS: Record<string, string> = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
};

export function json(
  data: unknown,
  status = 200,
  extra: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "x-robots-tag": "noindex",
      ...CORS,
      ...extra,
    },
  });
}

// Brand the default audience by host (the same bundle deploys to both the
// FamHop and Mosey Pages projects), overridable via an explicit param. The
// adults project serves trymosey.com (and nighthop.pages.dev as its fallback).
export function audienceFor(
  host: string,
  param: string | null | undefined,
): ApiAudience {
  if (param === "kids" || param === "adults") return param;
  return /trymosey|mosey|nighthop/i.test(host || "") ? "adults" : "kids";
}

// Merge query-string params with an optional JSON POST body (body wins).
export async function readParams(
  request: Request,
): Promise<Record<string, string>> {
  const url = new URL(request.url);
  const out: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    out[key] = value;
  });
  if (request.method === "POST") {
    try {
      const body = (await request.json()) as Record<string, unknown>;
      for (const [key, value] of Object.entries(body)) {
        if (value != null) out[key] = String(value);
      }
    } catch {
      // ignore malformed body, fall back to query params
    }
  }
  return out;
}
