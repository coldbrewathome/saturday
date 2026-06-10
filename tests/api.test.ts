// Tests for the client API helpers in src/api.ts: the brand dimension +
// returning-visitor logic in trackMetric, and the notifyEmail plumb-through
// in createPoll. The module reads import.meta.env at load time, so each test
// stubs the env and re-imports a fresh copy.
import { afterEach, describe, expect, it, vi } from "vitest";

type ApiModule = typeof import("../src/api");

async function importApi(): Promise<ApiModule> {
  vi.resetModules();
  vi.stubEnv("VITE_POLLS_API", "https://api.test");
  return import("../src/api");
}

function mockBeacon() {
  const beacon = vi.fn(() => true);
  Object.defineProperty(navigator, "sendBeacon", {
    value: beacon,
    configurable: true,
    writable: true,
  });
  return beacon;
}

/** Local-clock YYYY-MM-DD, mirroring the implementation. */
function localDay(date = new Date()): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.doUnmock("../src/appConfig");
  vi.resetModules();
});

describe("trackMetric", () => {
  it("injects brand=famhop in the beacon body for the default (kids) build", async () => {
    const api = await importApi();
    const beacon = mockBeacon();
    api.trackMetric("plan_created", "bay-area");
    expect(beacon).toHaveBeenCalledTimes(1);
    const [rawUrl, body] = beacon.mock.calls[0]! as unknown as [string, string];
    const url = new URL(rawUrl);
    expect(url.origin).toBe("https://api.test");
    expect(url.pathname).toBe("/metric");
    expect(url.searchParams.get("name")).toBe("plan_created");
    expect(url.searchParams.get("metro")).toBe("bay-area");
    // The worker reads `brand` from the JSON request body.
    expect(JSON.parse(body)).toEqual({ brand: "famhop" });
  });

  it("injects brand=mosey when the build audience is adults", async () => {
    // vi.stubEnv doesn't reach a re-imported module's import.meta.env
    // snapshot, so mock the appConfig module the brand derives from instead.
    vi.doMock("../src/appConfig", () => ({ APP_AUDIENCE: "adults" }));
    const api = await importApi();
    const beacon = mockBeacon();
    api.trackMetric("app_open");
    expect(beacon).toHaveBeenCalledTimes(1);
    const [, body] = beacon.mock.calls[0]! as unknown as [string, string];
    expect(JSON.parse(body)).toEqual({ brand: "mosey" });
  });

  it("records firstSeen on the first app_open without firing app_open_return", async () => {
    const api = await importApi();
    const beacon = mockBeacon();
    api.trackMetric("app_open", "bay-area");
    expect(beacon).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem("famhop:firstSeen")).toBe(localDay());
  });

  it("also fires app_open_return when firstSeen is a previous calendar day", async () => {
    const api = await importApi();
    const beacon = mockBeacon();
    window.localStorage.setItem("famhop:firstSeen", "2020-01-01");
    api.trackMetric("app_open", "bay-area");
    expect(beacon).toHaveBeenCalledTimes(2);
    const [rawUrl, body] = beacon.mock.calls[1]! as unknown as [string, string];
    const second = new URL(rawUrl);
    expect(second.searchParams.get("name")).toBe("app_open_return");
    expect(second.searchParams.get("metro")).toBe("bay-area");
    expect(JSON.parse(body)).toEqual({ brand: "famhop" });
    // firstSeen marks the *first* visit day; it must not advance.
    expect(window.localStorage.getItem("famhop:firstSeen")).toBe("2020-01-01");
  });

  it("does not fire app_open_return for a same-day repeat open", async () => {
    const api = await importApi();
    const beacon = mockBeacon();
    window.localStorage.setItem("famhop:firstSeen", localDay());
    api.trackMetric("app_open");
    expect(beacon).toHaveBeenCalledTimes(1);
  });

  it("leaves firstSeen untouched for non-app_open metrics", async () => {
    const api = await importApi();
    mockBeacon();
    api.trackMetric("plan_shared", "bay-area");
    expect(window.localStorage.getItem("famhop:firstSeen")).toBeNull();
  });
});

describe("createPoll", () => {
  function mockCreatePollFetch() {
    const fetchSpy = vi.fn(
      async (_url: RequestInfo | URL, _init?: RequestInit) =>
        new Response(JSON.stringify({ pollId: "p1", ownerToken: "o1" }), {
          status: 201,
        }),
    );
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("plumbs notifyEmail into the POST body", async () => {
    const api = await importApi();
    const fetchSpy = mockCreatePollFetch();
    await api.createPoll({
      title: "Test plan",
      metroId: "bay-area",
      stops: [],
      notifyEmail: "owner@example.com",
    });
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.test/polls");
    const body = JSON.parse(String(init?.body));
    expect(body.notifyEmail).toBe("owner@example.com");
    expect(body.title).toBe("Test plan");
  });

  it("omits notifyEmail from the body when not provided", async () => {
    const api = await importApi();
    const fetchSpy = mockCreatePollFetch();
    await api.createPoll({ title: "Test plan", stops: [] });
    const [, init] = fetchSpy.mock.calls[0]!;
    const body = JSON.parse(String(init?.body));
    expect("notifyEmail" in body).toBe(false);
  });
});
