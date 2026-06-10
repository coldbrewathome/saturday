// Endpoint-level tests for worker/src/index.ts using an in-memory KV stub:
// brand-scoped metrics, the newsletter unsubscribe flow, and poll vote
// notifications (notifyEmail privacy + throttled owner email).
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../worker/src/index";
import { unsubscribeToken } from "../worker/src/newsletter";

function makeKv() {
  const store = new Map<string, string>();
  return {
    store,
    async get(key: string): Promise<string | null> {
      return store.has(key) ? (store.get(key) as string) : null;
    },
    async put(key: string, value: string): Promise<void> {
      store.set(key, value);
    },
    async delete(key: string): Promise<void> {
      store.delete(key);
    },
    async list(opts?: { prefix?: string; cursor?: string }) {
      const keys = [...store.keys()]
        .filter((name) => !opts?.prefix || name.startsWith(opts.prefix))
        .map((name) => ({ name }));
      return { keys, list_complete: true, cursor: undefined };
    },
  };
}

type Kv = ReturnType<typeof makeKv>;

function makeEnv(kv: Kv, overrides: Record<string, string> = {}) {
  return {
    POLLS: kv,
    ALLOWED_ORIGINS: "https://famhop.com,https://trymosey.com",
    ADMIN_EMAILS: "admin@example.com",
    ...overrides,
  };
}

function makeCtx() {
  const tasks: Promise<unknown>[] = [];
  return {
    tasks,
    waitUntil(promise: Promise<unknown>) {
      tasks.push(promise);
    },
    passThroughOnException() {},
  };
}

async function call(
  env: ReturnType<typeof makeEnv>,
  url: string,
  init?: RequestInit,
  ctx = makeCtx(),
): Promise<Response> {
  // The worker types come from @cloudflare/workers-types; the test runs on
  // undici's fetch primitives, so cast across the two type worlds.
  return worker.fetch(
    new Request(url, init) as never,
    env as never,
    ctx as never,
  ) as unknown as Promise<Response>;
}

const today = new Date().toISOString().slice(0, 10);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /metric brand counters", () => {
  it("also increments metricb:{name}:{brand}:{day} when body.brand is valid", async () => {
    const kv = makeKv();
    const env = makeEnv(kv);
    const res = await call(env, "https://api.test/metric?name=hero_plan_created&metro=bay-area", {
      method: "POST",
      body: JSON.stringify({ brand: "mosey" }),
    });
    expect(res.status).toBe(204);
    expect(kv.store.get(`metric:hero_plan_created:all:${today}`)).toBe("1");
    expect(kv.store.get(`metric:hero_plan_created:bay-area:${today}`)).toBe("1");
    expect(kv.store.get(`metricb:hero_plan_created:mosey:${today}`)).toBe("1");
  });

  it("accepts the new app_open_return metric name", async () => {
    const kv = makeKv();
    const res = await call(makeEnv(kv), "https://api.test/metric?name=app_open_return", {
      method: "POST",
      body: JSON.stringify({ brand: "famhop" }),
    });
    expect(res.status).toBe(204);
    expect(kv.store.get(`metricb:app_open_return:famhop:${today}`)).toBe("1");
  });

  it("ignores unknown brands and missing bodies", async () => {
    const kv = makeKv();
    const env = makeEnv(kv);
    await call(env, "https://api.test/metric?name=app_open&metro=seattle", {
      method: "POST",
      body: JSON.stringify({ brand: "evilbrand" }),
    });
    await call(env, "https://api.test/metric?name=app_open&metro=seattle", {
      method: "POST",
    });
    expect(kv.store.get(`metric:app_open:all:${today}`)).toBe("2");
    const brandKeys = [...kv.store.keys()].filter((k) => k.startsWith("metricb:"));
    expect(brandKeys).toEqual([]);
  });
});

describe("GET /metrics byBrand", () => {
  it("aggregates metricb keys per brand without changing existing fields", async () => {
    const kv = makeKv();
    const env = makeEnv(kv);
    kv.store.set(
      "session:admintok",
      JSON.stringify({ sub: "1", email: "admin@example.com", name: "Admin" }),
    );
    kv.store.set(`metric:app_open:all:${today}`, "5");
    kv.store.set(`metric:app_open:bay-area:${today}`, "5");
    kv.store.set(`metricb:app_open:famhop:${today}`, "3");
    kv.store.set(`metricb:app_open:mosey:${today}`, "2");
    kv.store.set(`metricb:plan_shared:mosey:${today}`, "1");
    // Stale (outside window) brand key must be excluded.
    kv.store.set("metricb:app_open:mosey:2020-01-01", "99");

    const res = await call(env, "https://api.test/metrics?days=30", {
      headers: { authorization: "Bearer admintok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totals).toEqual({ app_open: 5 });
    expect(body.byMetro).toEqual({ "bay-area": { app_open: 5 } });
    expect(body.byBrand).toEqual({
      app_open: { famhop: 3, mosey: 2 },
      plan_shared: { famhop: 0, mosey: 1 },
    });
  });
});

describe("poll notifyEmail", () => {
  async function createPollWithNotify(env: ReturnType<typeof makeEnv>) {
    const res = await call(env, "https://api.test/polls", {
      method: "POST",
      body: JSON.stringify({
        title: "Saturday crew",
        metroId: "bay-area",
        stops: [{ id: "s1", name: "Park" }],
        notifyEmail: "Owner@Example.com",
      }),
    });
    expect(res.status).toBe(201);
    return (await res.json()) as { pollId: string };
  }

  it("stores notifyEmail but never returns it from GET /polls/:id", async () => {
    const kv = makeKv();
    const env = makeEnv(kv);
    const { pollId } = await createPollWithNotify(env);
    const stored = JSON.parse(kv.store.get(`poll:${pollId}`) as string);
    expect(stored.notifyEmail).toBe("owner@example.com");

    const res = await call(env, `https://api.test/polls/${pollId}`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("notifyEmail");
    expect(text).not.toContain("owner@example.com");
  });

  it("sends a throttled owner notification on votes when Resend is enabled", async () => {
    const kv = makeKv();
    const env = makeEnv(kv, {
      NEWSLETTER_ENABLED: "true",
      RESEND_API_KEY: "stub-key",
    });
    const { pollId } = await createPollWithNotify(env);

    const resendCalls: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.resend.com/emails" && init?.body) {
        resendCalls.push(JSON.parse(String(init.body)));
        return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });

    const ctx = makeCtx();
    const vote = await call(
      env,
      `https://api.test/polls/${pollId}/votes`,
      {
        method: "POST",
        headers: { origin: "https://trymosey.com" },
        body: JSON.stringify({ voterId: "friend-1", votes: { s1: "up" } }),
      },
      ctx,
    );
    expect(vote.status).toBe(200);
    expect(ctx.tasks.length).toBe(1);
    await Promise.all(ctx.tasks);

    expect(resendCalls).toHaveLength(1);
    expect(resendCalls[0].to).toEqual(["owner@example.com"]);
    expect(String(resendCalls[0].text)).toContain("1 friend has voted on your plan");
    // Poll URL uses the allowed request origin (Mosey poll links to Mosey).
    expect(String(resendCalls[0].text)).toContain(`https://trymosey.com/#/p/${pollId}`);

    // Second vote inside the 30-minute window: throttled, no second email.
    const ctx2 = makeCtx();
    await call(
      env,
      `https://api.test/polls/${pollId}/votes`,
      {
        method: "POST",
        body: JSON.stringify({ voterId: "friend-2", votes: { s1: "down" } }),
      },
      ctx2,
    );
    await Promise.all(ctx2.tasks);
    expect(resendCalls).toHaveLength(1);
    expect(kv.store.has(`pollnotify:${pollId}`)).toBe(true);
  });

  it("does not notify when NEWSLETTER_ENABLED is unset", async () => {
    const kv = makeKv();
    const env = makeEnv(kv, { RESEND_API_KEY: "stub-key" });
    const { pollId } = await createPollWithNotify(env);
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const ctx = makeCtx();
    const vote = await call(
      env,
      `https://api.test/polls/${pollId}/votes`,
      {
        method: "POST",
        body: JSON.stringify({ voterId: "friend-1", votes: { s1: "up" } }),
      },
      ctx,
    );
    expect(vote.status).toBe(200);
    expect(ctx.tasks).toHaveLength(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("newsletter subscribe + unsubscribe", () => {
  it("POST /newsletter returns {ok:true}", async () => {
    const kv = makeKv();
    const res = await call(makeEnv(kv), "https://api.test/newsletter", {
      method: "POST",
      body: JSON.stringify({ email: "fam@example.com", metroId: "bay-area" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("GET /newsletter/unsubscribe with a valid token deletes the subscriber and renders HTML", async () => {
    const kv = makeKv();
    // UNSUBSCRIBE_SECRET unset — NEWSLETTER_ADMIN_TOKEN is the fallback key.
    const env = makeEnv(kv, { NEWSLETTER_ADMIN_TOKEN: "admin-token" });
    for (const metro of ["bay-area", "seattle"]) {
      await call(env, "https://api.test/newsletter", {
        method: "POST",
        body: JSON.stringify({ email: "fam@example.com", metroId: metro }),
      });
    }
    expect(kv.store.has("newsletter:bay-area:fam%40example.com")).toBe(true);
    expect(kv.store.has("newsletter:seattle:fam%40example.com")).toBe(true);

    const token = await unsubscribeToken("fam@example.com", "admin-token");
    const res = await call(
      env,
      `https://api.test/newsletter/unsubscribe?email=fam%40example.com&token=${token}`,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("You're unsubscribed.");
    expect(kv.store.has("newsletter:bay-area:fam%40example.com")).toBe(false);
    expect(kv.store.has("newsletter:seattle:fam%40example.com")).toBe(false);
  });

  it("prefers UNSUBSCRIBE_SECRET over the admin-token fallback", async () => {
    const kv = makeKv();
    const env = makeEnv(kv, {
      UNSUBSCRIBE_SECRET: "dedicated-secret",
      NEWSLETTER_ADMIN_TOKEN: "admin-token",
    });
    const adminToken = await unsubscribeToken("fam@example.com", "admin-token");
    const res = await call(
      env,
      `https://api.test/newsletter/unsubscribe?email=fam%40example.com&token=${adminToken}`,
    );
    expect(res.status).toBe(400);
    const good = await unsubscribeToken("fam@example.com", "dedicated-secret");
    const ok = await call(
      env,
      `https://api.test/newsletter/unsubscribe?email=fam%40example.com&token=${good}`,
    );
    expect(ok.status).toBe(200);
  });

  it("rejects bad tokens and missing params with 400", async () => {
    const kv = makeKv();
    const env = makeEnv(kv, { NEWSLETTER_ADMIN_TOKEN: "admin-token" });
    await call(env, "https://api.test/newsletter", {
      method: "POST",
      body: JSON.stringify({ email: "fam@example.com", metroId: "bay-area" }),
    });
    const bad = await call(
      env,
      "https://api.test/newsletter/unsubscribe?email=fam%40example.com&token=deadbeef",
    );
    expect(bad.status).toBe(400);
    const missing = await call(env, "https://api.test/newsletter/unsubscribe");
    expect(missing.status).toBe(400);
    expect(kv.store.has("newsletter:bay-area:fam%40example.com")).toBe(true);
  });

  it("supports RFC 8058 one-click POST unsubscribe", async () => {
    const kv = makeKv();
    const env = makeEnv(kv, { NEWSLETTER_ADMIN_TOKEN: "admin-token" });
    await call(env, "https://api.test/newsletter", {
      method: "POST",
      body: JSON.stringify({ email: "fam@example.com", metroId: "bay-area" }),
    });
    const token = await unsubscribeToken("fam@example.com", "admin-token");
    const res = await call(
      env,
      `https://api.test/newsletter/unsubscribe?email=fam%40example.com&token=${token}`,
      { method: "POST", body: "List-Unsubscribe=One-Click" },
    );
    expect(res.status).toBe(200);
    expect(kv.store.has("newsletter:bay-area:fam%40example.com")).toBe(false);
  });
});
