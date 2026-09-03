// Tests for the check-in API client (src/checkinApi.ts): submission with a
// session token, public aggregate fetch, and user-history fetch.
import { afterEach, describe, expect, it, vi } from "vitest";

type CheckinModule = typeof import("../src/checkinApi");

async function importCheckinApi(): Promise<CheckinModule> {
  vi.resetModules();
  vi.stubEnv("VITE_POLLS_API", "https://api.test");
  return import("../src/checkinApi");
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
  // fetchEventTrust keeps a sessionStorage TTL cache — drop it so tests run
  // against a cold cache.
  sessionStorage.clear();
});

describe("submitCheckin", () => {
  it("POSTs the answer with the bearer token", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 201 }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const api = await importCheckinApi();
    await api.submitCheckin("event-1", true, "token-123");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.test/checkin");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).authorization).toBe(
      "Bearer token-123",
    );
    expect(JSON.parse(String(init.body))).toEqual({
      eventId: "event-1",
      worthIt: true,
    });
  });

  it("throws on non-2xx", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 401 }) as Response);
    const api = await importCheckinApi();
    await expect(
      api.submitCheckin("event-1", false, "token-123"),
    ).rejects.toThrow("Check-in failed (401)");
  });
});

describe("fetchEventTrust", () => {
  it("returns the aggregate with a trustScore percentage", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ worthIt: 8, notWorthIt: 2, total: 10, trustScore: 80 }),
      }) as Response),
    );
    const api = await importCheckinApi();
    await expect(api.fetchEventTrust("event-1")).resolves.toEqual({
      worthIt: 8,
      notWorthIt: 2,
      total: 10,
      trustScore: 80,
    });
  });

  it("returns null when the API is unconfigured", async () => {
    vi.unstubAllEnvs();
    vi.stubEnv("VITE_POLLS_API", "");
    const api = await importCheckinApi();
    await expect(api.fetchEventTrust("event-1")).resolves.toBeNull();
  });

  it("returns null on fetch failure", async () => {
    vi.stubGlobal("fetch", async () => ({ ok: false, status: 500 }) as Response);
    const api = await importCheckinApi();
    await expect(api.fetchEventTrust("event-1")).resolves.toBeNull();
  });
});

describe("fetchUserCheckins", () => {
  it("returns the user's check-in history", async () => {
    const history = { "event-1": { date: "2026-08-01T00:00:00Z", worthIt: true } };
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ checkins: history }),
      }) as Response),
    );
    const api = await importCheckinApi();
    await expect(api.fetchUserCheckins("token-123")).resolves.toEqual(history);
  });

  it("defaults to an empty record when the body lacks checkins", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }) as Response),
    );
    const api = await importCheckinApi();
    await expect(api.fetchUserCheckins("token-123")).resolves.toEqual({});
  });
});
