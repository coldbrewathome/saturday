import { describe, expect, it, vi } from "vitest";
import {
  loadAnalytics,
  normalizeMetricsResponse,
  type MetricsResponse,
} from "../src/ops/loadAnalytics";

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

  it("requests `/metrics?days=N` with credentials so the admin cookie is sent", async () => {
    const fetchImpl = mockFetch({
      status: 200,
      jsonBody: {} satisfies MetricsResponse,
    });
    await loadAnalytics({ fetchImpl, days: 14 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("/metrics?days=14");
    expect((opts as RequestInit | undefined)?.credentials).toBe("include");
  });

  it("honors baseUrl and trims trailing slash", async () => {
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    await loadAnalytics({ fetchImpl, baseUrl: "https://api.example.com/" });
    const [url] = fetchImpl.mock.calls[0]!;
    expect(url).toBe("https://api.example.com/metrics?days=30");
  });

  it("clamps days to the 1–90 range the worker accepts", async () => {
    const fetchImpl = mockFetch({ status: 200, jsonBody: {} });
    await loadAnalytics({ fetchImpl, days: 9999 });
    expect(fetchImpl.mock.calls[0]![0]).toBe("/metrics?days=90");
    await loadAnalytics({ fetchImpl, days: 0 });
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
