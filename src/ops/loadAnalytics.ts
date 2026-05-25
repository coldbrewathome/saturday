// Loader for the operator analytics dashboard. Wraps the worker's
// `GET /metrics` endpoint (extended per ADR 03 to include a `byMetro` map)
// into a normalized shape the dashboard can render directly.
//
// Auth: the endpoint requires an admin session cookie. We send
// `credentials: "include"` so the existing Google sign-in cookie flows
// through. 401/403 → `{ status: "unauthorized" }` empty state so the UI can
// render a sign-in CTA instead of crashing. Any other failure (network,
// 5xx, malformed JSON) → `{ status: "error" }`. A successful but empty KV
// (fresh deploy, before the first metric fires) → `{ status: "ok" }` with
// zeroed maps so the dashboard renders "0" cards rather than blank space.
//
// `normalizeMetricsResponse` is the pure core (easy to unit-test).
// `loadAnalytics` is the browser-side wrapper.
//
// The known metric names list is duplicated from `worker/src/index.ts`
// (`METRIC_NAMES`) intentionally — the worker owns the allowlist for
// writes, and the dashboard owns the allowlist for renders. Keeping them
// in sync is a one-line manual step; cross-importing would couple the
// worker bundle to the frontend.

export type MetricName =
  | "app_open"
  | "hop_now_opened"
  | "plan_shared"
  | "poll_viewed"
  | "vote_cast"
  | "weekend_guide_click"
  | "signin_prompt_shown"
  | "signin_prompt_clicked"
  | "newsletter_subscribed";

export const METRIC_NAMES: readonly MetricName[] = [
  "app_open",
  "hop_now_opened",
  "plan_shared",
  "poll_viewed",
  "vote_cast",
  "weekend_guide_click",
  "signin_prompt_shown",
  "signin_prompt_clicked",
  "newsletter_subscribed",
];

export type MetricTotals = Partial<Record<MetricName, number>>;

/** Raw shape returned by `GET /metrics` after the ADR 03 worker change. */
export type MetricsResponse = {
  days?: number;
  totals?: Record<string, number>;
  byDay?: Record<string, Record<string, number>>;
  byMetro?: Record<string, Record<string, number>>;
};

export type AnalyticsData = {
  /** Window size in days (echoed from the request; defaults to 30). */
  days: number;
  /** Total per metric over the window. Every known metric is present (0 if absent). */
  totals: Record<MetricName, number>;
  /** Per-day per-metric counts. Days with no events are omitted. */
  byDay: Record<string, MetricTotals>;
  /** Per-metro per-metric counts. Metros with no events are omitted. */
  byMetro: Record<string, MetricTotals>;
};

export type LoadAnalyticsResult =
  | { status: "ok"; data: AnalyticsData }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

function zeroTotals(): Record<MetricName, number> {
  const out = {} as Record<MetricName, number>;
  for (const name of METRIC_NAMES) out[name] = 0;
  return out;
}

function pickMetricCounts(raw: Record<string, number> | undefined): MetricTotals {
  if (!raw || typeof raw !== "object") return {};
  const out: MetricTotals = {};
  for (const name of METRIC_NAMES) {
    const value = raw[name];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      out[name] = value;
    }
  }
  return out;
}

/**
 * Normalize the worker response into a shape the dashboard can render
 * without per-field null-checks. Filters down to the allowlisted metric
 * names; unknown names in the response are silently dropped so a worker
 * adding a new metric ahead of a frontend deploy doesn't crash the UI.
 */
export function normalizeMetricsResponse(
  response: MetricsResponse | null | undefined,
): AnalyticsData {
  const days =
    typeof response?.days === "number" && response.days > 0 ? response.days : 30;

  const totals = zeroTotals();
  if (response?.totals && typeof response.totals === "object") {
    for (const name of METRIC_NAMES) {
      const value = response.totals[name];
      if (typeof value === "number" && Number.isFinite(value)) {
        totals[name] = value;
      }
    }
  }

  const byDay: Record<string, MetricTotals> = {};
  if (response?.byDay && typeof response.byDay === "object") {
    for (const [date, counts] of Object.entries(response.byDay)) {
      const filtered = pickMetricCounts(counts);
      if (Object.keys(filtered).length > 0) byDay[date] = filtered;
    }
  }

  const byMetro: Record<string, MetricTotals> = {};
  if (response?.byMetro && typeof response.byMetro === "object") {
    for (const [metroId, counts] of Object.entries(response.byMetro)) {
      // The worker should never emit the `all` bucket here, but defend in
      // case an older worker is deployed alongside a newer frontend.
      if (!metroId || metroId === "all") continue;
      const filtered = pickMetricCounts(counts);
      if (Object.keys(filtered).length > 0) byMetro[metroId] = filtered;
    }
  }

  return { days, totals, byDay, byMetro };
}

export type LoadAnalyticsOptions = {
  /** Window size in days (1–90). Defaults to 30. */
  days?: number;
  /** Base URL for the worker. Defaults to "" (same-origin). */
  baseUrl?: string;
  /** Override fetch (for tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * sessionStorage key for the cached `AnalyticsData`. The trailing `:v1`
 * lets us invalidate cleanly if the cached shape changes; `days` is part of
 * the key so different window sizes don't collide.
 */
export const CACHE_KEY_PREFIX = "famhop.opsAnalytics.cache:v1";
/** Cache TTL in ms. 5 min keeps reloads instant without serving badly stale data. */
export const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  /** ms epoch the entry was written. */
  ts: number;
  /** The normalized data ready to render. */
  data: AnalyticsData;
};

/**
 * Read a cached `AnalyticsData` if one exists for this window and is still
 * fresh. Returns `null` for missing/stale/corrupt entries. Pure on `now`
 * and `storage` so tests don't need a real Storage.
 */
export function readCachedAnalytics(
  days: number,
  now: number = Date.now(),
  storage: Pick<Storage, "getItem"> | null | undefined = typeof window !==
    "undefined"
    ? window.sessionStorage
    : null,
): AnalyticsData | null {
  if (!storage) return null;
  let raw: string | null;
  try {
    raw = storage.getItem(`${CACHE_KEY_PREFIX}:${days}`);
  } catch {
    return null;
  }
  if (!raw) return null;
  let entry: CacheEntry;
  try {
    entry = JSON.parse(raw) as CacheEntry;
  } catch {
    return null;
  }
  if (!entry || typeof entry.ts !== "number" || !entry.data) return null;
  if (now - entry.ts > CACHE_TTL_MS) return null;
  return entry.data;
}

/**
 * Persist `data` to the cache. Silently swallows storage errors (private
 * mode, quota exceeded) — the cache is a performance hint, not a hard
 * requirement.
 */
export function writeCachedAnalytics(
  days: number,
  data: AnalyticsData,
  now: number = Date.now(),
  storage: Pick<Storage, "setItem"> | null | undefined = typeof window !==
    "undefined"
    ? window.sessionStorage
    : null,
): void {
  if (!storage) return;
  const entry: CacheEntry = { ts: now, data };
  try {
    storage.setItem(`${CACHE_KEY_PREFIX}:${days}`, JSON.stringify(entry));
  } catch {
    // Ignore: cache is best-effort.
  }
}

/**
 * Fetch `/metrics?days=N` from the worker with the admin session cookie.
 * Normalizes the response into `AnalyticsData`. Returns a discriminated
 * union so the caller can render the right empty state.
 *
 * Successful results are written to the sessionStorage cache so subsequent
 * dashboard mounts in the same tab can render synchronously; the cache is
 * read separately via `readCachedAnalytics` so the caller can paint the
 * stale value before awaiting the network.
 */
export async function loadAnalytics(
  opts: LoadAnalyticsOptions = {},
): Promise<LoadAnalyticsResult> {
  const days = Math.min(90, Math.max(1, opts.days ?? 30));
  const baseUrl = (opts.baseUrl ?? "").replace(/\/$/, "");
  const fetchImpl = opts.fetchImpl ?? fetch;
  const url = `${baseUrl}/metrics?days=${days}`;

  let response: Response;
  try {
    response = await fetchImpl(url, { credentials: "include" });
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "network error",
    };
  }

  if (response.status === 401 || response.status === 403) {
    return { status: "unauthorized" };
  }
  if (!response.ok) {
    return { status: "error", message: `HTTP ${response.status}` };
  }

  let body: MetricsResponse;
  try {
    body = (await response.json()) as MetricsResponse;
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : "invalid JSON",
    };
  }

  const data = normalizeMetricsResponse(body);
  writeCachedAnalytics(days, data);
  return { status: "ok", data };
}
