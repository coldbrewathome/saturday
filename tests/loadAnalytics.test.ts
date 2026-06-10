import { describe, expect, it, vi } from "vitest";
import {
  CACHE_KEY_PREFIX,
  CACHE_TTL_MS,
  loadAnalytics,
  normalizeMetricsResponse,
  readCachedAnalytics,
  writeCachedAnalytics,
  type AnalyticsData,
  type MetricsResponse,
} from "../src/ops/loadAnalytics";
import {
  CARD_SPECS,
  buildSparklinePath,
  buildSparklineSeries,
  computeBrandSplit,
  computeCardData,
  computeMetroRows,
  deltaClass,
  formatDelta,
  isoDay,
  sumWindow,
} from "../src/ops/OpsAnalyticsView";
import { API_BASE } from "../src/api";

describe("normalizeMetricsResponse", () => {
  it("returns zeroed totals + empty maps for a totally empty response", () => {
    const data = normalizeMetricsResponse({});
    expect(data.days).toBe(30);
    expect(data.totals.app_open).toBe(0);
    expect(data.totals.vote_cast).toBe(0);
    expect(Object.keys(data.byDay)).toEqual([]);
    expect(Object.keys(data.byMetro)).toEqual([]);
  });

  it("returns zeroed defaults for null/undefined input", () => {
    const fromNull = normalizeMetricsResponse(null);
    const fromUndef = normalizeMetricsResponse(undefined);
    expect(fromNull.days).toBe(30);
    expect(fromUndef.days).toBe(30);
    expect(fromNull.totals.app_open).toBe(0);
    expect(fromUndef.totals.app_open).toBe(0);
  });

  it("preserves totals for known metrics and zero-fills missing ones", () => {
    const data = normalizeMetricsResponse({
      days: 7,
      totals: { app_open: 42, vote_cast: 3 },
    });
    expect(data.days).toBe(7);
    expect(data.totals.app_open).toBe(42);
    expect(data.totals.vote_cast).toBe(3);
    expect(data.totals.hop_now_opened).toBe(0);
    expect(data.totals.newsletter_subscribed).toBe(0);
  });

  it("drops unknown metric names from totals", () => {
    const data = normalizeMetricsResponse({
      totals: { app_open: 5, some_future_metric: 99 },
    });
    expect(data.totals.app_open).toBe(5);
    expect((data.totals as Record<string, number>).some_future_metric).toBeUndefined();
  });

  it("filters out days where every count is zero or unknown", () => {
    const data = normalizeMetricsResponse({
      byDay: {
        "2026-05-24": { app_open: 10, vote_cast: 2 },
        "2026-05-23": { app_open: 0, unknown_metric: 7 },
      },
    });
    expect(data.byDay["2026-05-24"]).toEqual({ app_open: 10, vote_cast: 2 });
    expect(data.byDay["2026-05-23"]).toBeUndefined();
  });

  it("filters byMetro and excludes the `all` bucket if a stale worker emits it", () => {
    const data = normalizeMetricsResponse({
      byMetro: {
        atlanta: { app_open: 12 },
        boston: { app_open: 8, vote_cast: 1 },
        all: { app_open: 20 },
        "": { app_open: 3 },
      },
    });
    expect(Object.keys(data.byMetro).sort()).toEqual(["atlanta", "boston"]);
    expect(data.byMetro.atlanta).toEqual({ app_open: 12 });
    expect(data.byMetro.boston).toEqual({ app_open: 8, vote_cast: 1 });
  });

  it("handles a missing byMetro field (backwards compat with pre-ADR-03 worker)", () => {
    const data = normalizeMetricsResponse({
      days: 30,
      totals: { app_open: 100 },
      byDay: { "2026-05-24": { app_open: 100 } },
    });
    expect(data.byMetro).toEqual({});
    expect(data.totals.app_open).toBe(100);
  });

  it("filters byBrand to known metrics and drops all-zero buckets", () => {
    const data = normalizeMetricsResponse({
      byBrand: {
        app_open: { famhop: 12, mosey: 3 },
        vote_cast: { famhop: 0, mosey: 0 },
        unknown_metric: { famhop: 7, mosey: 7 },
      },
    });
    expect(Object.keys(data.byBrand)).toEqual(["app_open"]);
    expect(data.byBrand.app_open).toEqual({ famhop: 12, mosey: 3 });
  });

  it("zero-fills a missing brand inside a byBrand bucket", () => {
    const data = normalizeMetricsResponse({
      byBrand: { app_open: { famhop: 9 } },
    });
    expect(data.byBrand.app_open).toEqual({ famhop: 9, mosey: 0 });
  });

  it("handles a missing byBrand field (backwards compat with older worker)", () => {
    const data = normalizeMetricsResponse({
      days: 30,
      totals: { app_open: 100 },
    });
    expect(data.byBrand).toEqual({});
  });

  it("ignores non-finite numeric values defensively", () => {
    const data = normalizeMetricsResponse({
      totals: {
        app_open: Number.NaN,
        vote_cast: Number.POSITIVE_INFINITY,
        hop_now_opened: 5,
      },
    });
    expect(data.totals.app_open).toBe(0);
    expect(data.totals.vote_cast).toBe(0);
    expect(data.totals.hop_now_opened).toBe(5);
  });
});

function mockFetch(
  init: ResponseInit & { jsonBody?: unknown; throws?: Error; bodyText?: string },
) {
  return vi.fn(async (_url: RequestInfo | URL, _opts?: RequestInit) => {
    if (init.throws) throw init.throws;
    const body =
      init.bodyText !== undefined ? init.bodyText : JSON.stringify(init.jsonBody ?? {});
    return new Response(body, init);
  });
}

describe("loadAnalytics", () => {
  it("returns ok + normalized data on a healthy 200 response", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      jsonBody: {
        days: 30,
        totals: { app_open: 100 },
        byDay: {},
        byMetro: { atlanta: { app_open: 60 }, boston: { app_open: 40 } },
      } satisfies MetricsResponse,
    });
    const result = await loadAnalytics({ fetchImpl });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.totals.app_open).toBe(100);
    expect(result.data.byMetro.atlanta).toEqual({ app_open: 60 });
  });

  it("requests `/metrics?days=N` with an Authorization: Bearer header", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      jsonBody: {} satisfies MetricsResponse,
    });
    await loadAnalytics({ fetchImpl, days: 14, baseUrl: "", sessionToken: "tok-1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/metrics?days=14");
    expect((opts as RequestInit | undefined)?.headers).toEqual({
      authorization: "Bearer tok-1",
    });
  });

  it("defaults the token to the stored Google session (same as /me/state)", async () => {
    window.localStorage.setItem(
      "saturday.session",
      JSON.stringify({ token: "stored-tok", user: { email: "a@b.c", name: "A" } }),
    );
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    await loadAnalytics({ fetchImpl, baseUrl: "" });
    const [, opts] = fetchImpl.mock.calls[0]!;
    expect((opts as RequestInit | undefined)?.headers).toEqual({
      authorization: "Bearer stored-tok",
    });
  });

  it("sends no Authorization header when there is no session", async () => {
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    await loadAnalytics({ fetchImpl, baseUrl: "" });
    const [, opts] = fetchImpl.mock.calls[0]!;
    expect(opts).toBeUndefined();
  });

  it("defaults baseUrl to the worker origin the rest of the app uses", async () => {
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    await loadAnalytics({ fetchImpl });
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe(`${API_BASE}/metrics?days=30`);
  });

  it("honors baseUrl and trims trailing slash", async () => {
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    await loadAnalytics({ fetchImpl, baseUrl: "https://api.example.com/" });
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/metrics?days=30");
  });

  it("clamps days to the 1–90 range the worker accepts", async () => {
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    await loadAnalytics({ fetchImpl, days: 9999, baseUrl: "" });
    expect(fetchImpl.mock.calls[0]![0]).toBe("/metrics?days=90");
    await loadAnalytics({ fetchImpl, days: 0, baseUrl: "" });
    expect(fetchImpl.mock.calls[1]![0]).toBe("/metrics?days=1");
  });

  it("returns unauthorized on a 401", async () => {
    const fetchImpl = mockFetch({ status: 401, jsonBody: { error: "sign in" } });
    const result = await loadAnalytics({ fetchImpl });
    expect(result.status).toBe("unauthorized");
  });

  it("returns unauthorized on a 403", async () => {
    const fetchImpl = mockFetch({ status: 403, jsonBody: { error: "admin only" } });
    const result = await loadAnalytics({ fetchImpl });
    expect(result.status).toBe("unauthorized");
  });

  it("returns error on a 5xx with the status code in the message", async () => {
    const fetchImpl = mockFetch({ status: 503, jsonBody: {} });
    const result = await loadAnalytics({ fetchImpl });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.message).toBe("HTTP 503");
  });

  it("returns error when fetch throws (network failure)", async () => {
    const fetchImpl = mockFetch({ status: 200, throws: new Error("offline") });
    const result = await loadAnalytics({ fetchImpl });
    expect(result.status).toBe("error");
    if (result.status !== "error") return;
    expect(result.message).toBe("offline");
  });

  it("returns error when the body is not valid JSON", async () => {
    const fetchImpl = mockFetch({ status: 200, bodyText: "<html>oops</html>" });
    const result = await loadAnalytics({ fetchImpl });
    expect(result.status).toBe("error");
  });

  it("treats an empty body (fresh KV) as ok with zero counters", async () => {
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    const result = await loadAnalytics({ fetchImpl });
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.data.totals.app_open).toBe(0);
    expect(result.data.totals.vote_cast).toBe(0);
    expect(Object.keys(result.data.byMetro)).toEqual([]);
  });
});

describe("isoDay", () => {
  it("returns today for offset 0", () => {
    const today = new Date("2026-05-25T10:00:00Z");
    expect(isoDay(today, 0)).toBe("2026-05-25");
  });

  it("returns yesterday for offset 1", () => {
    const today = new Date("2026-05-25T10:00:00Z");
    expect(isoDay(today, 1)).toBe("2026-05-24");
  });

  it("crosses month boundaries cleanly", () => {
    const today = new Date("2026-06-02T10:00:00Z");
    expect(isoDay(today, 5)).toBe("2026-05-28");
  });
});

describe("sumWindow", () => {
  const byDay: AnalyticsData["byDay"] = {
    "2026-05-20": { app_open: 5, vote_cast: 1 },
    "2026-05-21": { app_open: 7 },
    "2026-05-22": { app_open: 3, vote_cast: 2 },
    "2026-05-23": { vote_cast: 4 },
  };

  it("sums inclusive of both endpoints", () => {
    expect(sumWindow(byDay, "app_open", "2026-05-20", "2026-05-22")).toBe(15);
  });

  it("returns 0 when the metric is absent across the window", () => {
    expect(sumWindow(byDay, "hop_now_opened", "2026-05-20", "2026-05-23")).toBe(
      0,
    );
  });

  it("ignores days outside the window", () => {
    expect(sumWindow(byDay, "app_open", "2026-05-21", "2026-05-21")).toBe(7);
  });

  it("returns 0 when byDay is empty", () => {
    expect(sumWindow({}, "app_open", "2026-05-20", "2026-05-23")).toBe(0);
  });
});

describe("computeCardData", () => {
  const today = new Date("2026-05-25T10:00:00Z");

  it("returns one card per CARD_SPECS entry in the same order", () => {
    const data = normalizeMetricsResponse({});
    const cards = computeCardData(data, today);
    expect(cards.map((c) => c.metric)).toEqual(
      CARD_SPECS.map((s) => s.metric),
    );
  });

  it("sums the 7-day current window ending yesterday", () => {
    // today=2026-05-25 → current window = [05-18, 05-24]
    const data = normalizeMetricsResponse({
      byDay: {
        "2026-05-25": { app_open: 100 }, // today, excluded
        "2026-05-24": { app_open: 10 }, // yesterday, included
        "2026-05-18": { app_open: 3 }, // window start, included
        "2026-05-17": { app_open: 999 }, // before window, excluded
      },
    });
    const cards = computeCardData(data, today);
    const appOpen = cards.find((c) => c.metric === "app_open");
    expect(appOpen?.current).toBe(13);
  });

  it("sums the prior 7-day window immediately before current", () => {
    // today=2026-05-25 → prior window = [05-11, 05-17]
    const data = normalizeMetricsResponse({
      byDay: {
        "2026-05-17": { vote_cast: 4 },
        "2026-05-11": { vote_cast: 1 },
        "2026-05-10": { vote_cast: 999 }, // before window
        "2026-05-18": { vote_cast: 999 }, // in current window, not prior
      },
    });
    const cards = computeCardData(data, today);
    const voteCast = cards.find((c) => c.metric === "vote_cast");
    expect(voteCast?.prior).toBe(5);
  });

  it("computes delta as current - prior", () => {
    const data = normalizeMetricsResponse({
      byDay: {
        "2026-05-20": { plan_shared: 10 }, // current
        "2026-05-13": { plan_shared: 4 }, // prior
      },
    });
    const cards = computeCardData(data, today);
    const planShared = cards.find((c) => c.metric === "plan_shared");
    expect(planShared?.current).toBe(10);
    expect(planShared?.prior).toBe(4);
    expect(planShared?.delta).toBe(6);
  });

  it("zeroes everything when byDay is empty", () => {
    const data = normalizeMetricsResponse({});
    const cards = computeCardData(data, today);
    for (const card of cards) {
      expect(card.current).toBe(0);
      expect(card.prior).toBe(0);
      expect(card.delta).toBe(0);
    }
  });
});

describe("formatDelta", () => {
  it("renders '—' when both prior and delta are zero (no data yet)", () => {
    expect(formatDelta({ delta: 0, prior: 0 })).toBe("—");
  });

  it("prefixes positive deltas with +", () => {
    expect(formatDelta({ delta: 12, prior: 5 })).toBe("+12");
  });

  it("renders negative deltas with the minus sign", () => {
    expect(formatDelta({ delta: -3, prior: 10 })).toBe("-3");
  });

  it("renders '0' when there's prior data but no change", () => {
    expect(formatDelta({ delta: 0, prior: 8 })).toBe("0");
  });
});

describe("computeMetroRows", () => {
  it("returns rows sorted by total desc for the headline metric", () => {
    const data = normalizeMetricsResponse({
      byMetro: {
        atlanta: { app_open: 12 },
        boston: { app_open: 30 },
        chicago: { app_open: 7 },
      },
    });
    const rows = computeMetroRows(data);
    expect(rows.map((r) => r.metroId)).toEqual(["boston", "atlanta", "chicago"]);
    expect(rows[0]?.total).toBe(30);
  });

  it("resolves label and canonicalPath from the metros config", () => {
    const data = normalizeMetricsResponse({
      byMetro: { atlanta: { app_open: 5 } },
    });
    const rows = computeMetroRows(data);
    expect(rows[0]?.label).toBe("Atlanta");
    expect(rows[0]?.canonicalPath).toBe("/atlanta");
  });

  it("omits metros whose headline-metric count is zero or missing", () => {
    const data = normalizeMetricsResponse({
      byMetro: {
        atlanta: { app_open: 5 },
        boston: { vote_cast: 3 }, // no app_open
      },
    });
    const rows = computeMetroRows(data);
    expect(rows.map((r) => r.metroId)).toEqual(["atlanta"]);
  });

  it("breaks ties on total by label asc for stable ordering", () => {
    const data = normalizeMetricsResponse({
      byMetro: {
        boston: { app_open: 10 },
        atlanta: { app_open: 10 },
      },
    });
    const rows = computeMetroRows(data);
    expect(rows.map((r) => r.metroId)).toEqual(["atlanta", "boston"]);
  });

  it("falls back to the raw metro id when the metro is not in the config", () => {
    const data = normalizeMetricsResponse({
      byMetro: { "made-up-metro": { app_open: 4 } },
    });
    const rows = computeMetroRows(data);
    expect(rows[0]?.label).toBe("made-up-metro");
    expect(rows[0]?.canonicalPath).toBeNull();
  });

  it("returns [] when byMetro is empty", () => {
    const data = normalizeMetricsResponse({});
    expect(computeMetroRows(data)).toEqual([]);
  });

  it("accepts an override metric for ad-hoc breakdowns", () => {
    const data = normalizeMetricsResponse({
      byMetro: {
        atlanta: { app_open: 1, vote_cast: 9 },
        boston: { app_open: 99, vote_cast: 2 },
      },
    });
    const rows = computeMetroRows(data, "vote_cast");
    expect(rows.map((r) => r.metroId)).toEqual(["atlanta", "boston"]);
  });
});

describe("computeBrandSplit", () => {
  it("returns null when the response has no byBrand section (older worker)", () => {
    const data = normalizeMetricsResponse({});
    expect(computeBrandSplit(data, "app_open")).toBeNull();
  });

  it("returns famhop/mosey totals for the metric", () => {
    const data = normalizeMetricsResponse({
      byBrand: {
        app_open: { famhop: 12, mosey: 5 },
        vote_cast: { famhop: 3, mosey: 0 },
      },
    });
    expect(computeBrandSplit(data, "app_open")).toEqual({ famhop: 12, mosey: 5 });
    expect(computeBrandSplit(data, "vote_cast")).toEqual({ famhop: 3, mosey: 0 });
  });

  it("zero-fills a metric absent from byBrand when other metrics have data", () => {
    const data = normalizeMetricsResponse({
      byBrand: { app_open: { famhop: 9 } },
    });
    expect(computeBrandSplit(data, "vote_cast")).toEqual({ famhop: 0, mosey: 0 });
    expect(computeBrandSplit(data, "app_open")).toEqual({ famhop: 9, mosey: 0 });
  });
});

describe("deltaClass", () => {
  it("returns the up modifier for a positive delta", () => {
    expect(deltaClass({ delta: 4, prior: 1 })).toBe("ops-analytics-delta-up");
  });

  it("returns the down modifier for a negative delta", () => {
    expect(deltaClass({ delta: -2, prior: 5 })).toBe(
      "ops-analytics-delta-down",
    );
  });

  it("returns the empty class for the no-prior-data case", () => {
    expect(deltaClass({ delta: 0, prior: 0 })).toBe("");
  });

  it("returns the empty class for a flat WoW comparison", () => {
    expect(deltaClass({ delta: 0, prior: 6 })).toBe("");
  });
});

describe("buildSparklineSeries", () => {
  const today = new Date("2026-05-25T10:00:00Z");

  it("returns `days` points ending at yesterday (today excluded)", () => {
    const series = buildSparklineSeries({}, "app_open", 30, today);
    expect(series.length).toBe(30);
    expect(series[0]?.date).toBe("2026-04-25"); // 30 days back
    expect(series[series.length - 1]?.date).toBe("2026-05-24"); // yesterday
  });

  it("fills missing days with 0", () => {
    const series = buildSparklineSeries({}, "app_open", 7, today);
    for (const p of series) expect(p.value).toBe(0);
  });

  it("picks up the right metric values for known days", () => {
    const data = normalizeMetricsResponse({
      byDay: {
        "2026-05-24": { app_open: 10, vote_cast: 99 },
        "2026-05-22": { app_open: 3 },
        "2026-05-25": { app_open: 50 }, // today, excluded
      },
    });
    const series = buildSparklineSeries(data.byDay, "app_open", 7, today);
    expect(series.find((p) => p.date === "2026-05-24")?.value).toBe(10);
    expect(series.find((p) => p.date === "2026-05-22")?.value).toBe(3);
    expect(series.find((p) => p.date === "2026-05-23")?.value).toBe(0);
    expect(series.find((p) => p.date === "2026-05-25")).toBeUndefined();
  });

  it("ignores other metrics on the same day", () => {
    const data = normalizeMetricsResponse({
      byDay: { "2026-05-24": { vote_cast: 7 } },
    });
    const series = buildSparklineSeries(data.byDay, "app_open", 3, today);
    for (const p of series) expect(p.value).toBe(0);
  });
});

describe("buildSparklinePath", () => {
  it("returns '' for an empty series", () => {
    expect(buildSparklinePath([], 100, 50)).toBe("");
  });

  it("emits a single M command for a one-point series", () => {
    const path = buildSparklinePath([{ date: "x", value: 5 }], 100, 50);
    expect(path.startsWith("M")).toBe(true);
    expect(path.includes("L")).toBe(false);
  });

  it("scales x evenly from 0..width", () => {
    const series = [
      { date: "a", value: 1 },
      { date: "b", value: 1 },
      { date: "c", value: 1 },
    ];
    const path = buildSparklinePath(series, 100, 50);
    // 3 points → x = 0, 50, 100
    expect(path).toContain("M0.00");
    expect(path).toContain("L50.00");
    expect(path).toContain("L100.00");
  });

  it("anchors a flat-zero series at the bottom (y=height)", () => {
    const series = [
      { date: "a", value: 0 },
      { date: "b", value: 0 },
    ];
    const path = buildSparklinePath(series, 100, 50);
    // Both points sit at y = 50 (the baseline).
    expect(path).toBe("M0.00 50.00 L100.00 50.00");
  });

  it("inverts y so the peak draws at the top (y=0)", () => {
    const series = [
      { date: "a", value: 0 },
      { date: "b", value: 10 },
    ];
    const path = buildSparklinePath(series, 100, 50);
    // Peak (value=10) → y=0; trough (value=0) → y=50.
    expect(path).toBe("M0.00 50.00 L100.00 0.00");
  });
});

describe("analytics cache", () => {
  function makeStorage(): Storage {
    const store = new Map<string, string>();
    return {
      getItem: (k) => (store.has(k) ? store.get(k)! : null),
      setItem: (k, v) => {
        store.set(k, v);
      },
      removeItem: (k) => {
        store.delete(k);
      },
      clear: () => store.clear(),
      key: (i) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    } as Storage;
  }

  it("round-trips a write/read within the TTL", () => {
    const storage = makeStorage();
    const data = normalizeMetricsResponse({ totals: { app_open: 12 } });
    writeCachedAnalytics(30, data, 1000, storage);
    const got = readCachedAnalytics(30, 2000, storage);
    expect(got?.totals.app_open).toBe(12);
  });

  it("returns null past the TTL", () => {
    const storage = makeStorage();
    const data = normalizeMetricsResponse({});
    writeCachedAnalytics(30, data, 1000, storage);
    expect(readCachedAnalytics(30, 1000 + CACHE_TTL_MS + 1, storage)).toBeNull();
  });

  it("keys on days so different windows don't collide", () => {
    const storage = makeStorage();
    const small = normalizeMetricsResponse({ totals: { app_open: 1 } });
    const big = normalizeMetricsResponse({ totals: { app_open: 99 } });
    writeCachedAnalytics(7, small, 1000, storage);
    writeCachedAnalytics(30, big, 1000, storage);
    expect(readCachedAnalytics(7, 1000, storage)?.totals.app_open).toBe(1);
    expect(readCachedAnalytics(30, 1000, storage)?.totals.app_open).toBe(99);
  });

  it("returns null for a missing entry", () => {
    expect(readCachedAnalytics(30, 1000, makeStorage())).toBeNull();
  });

  it("returns null on corrupt JSON without throwing", () => {
    const storage = makeStorage();
    storage.setItem(`${CACHE_KEY_PREFIX}:30`, "{not json");
    expect(readCachedAnalytics(30, 1000, storage)).toBeNull();
  });

  it("treats null storage as a no-op (SSR / disabled)", () => {
    expect(readCachedAnalytics(30, 1000, null)).toBeNull();
    expect(() =>
      writeCachedAnalytics(30, normalizeMetricsResponse({}), 1000, null),
    ).not.toThrow();
  });

  it("swallows setItem errors so quota issues don't break the loader", () => {
    const broken: Storage = {
      ...makeStorage(),
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(() =>
      writeCachedAnalytics(30, normalizeMetricsResponse({}), 1000, broken),
    ).not.toThrow();
  });
});
