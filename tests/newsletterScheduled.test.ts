import { describe, expect, it } from "vitest";
import {
  DEFAULT_WORKER_ORIGIN,
  listSubscribers,
  runScheduledDigest,
  type SubscriberKv,
} from "../worker/src/newsletter";

// Minimal KV double: a flat key → value map plus list() pagination.
function makeKv(
  entries: Record<string, string>,
  pageSize = 2,
): SubscriberKv & { puts: string[] } {
  const keys = Object.keys(entries);
  const puts: string[] = [];
  return {
    puts,
    async get(key: string) {
      return entries[key] ?? null;
    },
    async put(key: string, value: string) {
      puts.push(key);
      entries[key] = value;
    },
    async list({ prefix, cursor }: { prefix: string; cursor?: string }) {
      const matching = keys.filter((key) => key.startsWith(prefix));
      const start = cursor ? matching.indexOf(cursor) + 1 : 0;
      const page = matching.slice(start, start + pageSize);
      const last = page[page.length - 1];
      const complete = start + pageSize >= matching.length;
      return {
        keys: page.map((name) => ({ name })),
        list_complete: complete,
        cursor: complete ? undefined : last,
      };
    },
  };
}

const subscriber = (email: string, metroId: string) =>
  JSON.stringify({ email, metroId, ageBands: ["3-5"], interests: ["animals"], createdAt: "x" });

describe("listSubscribers", () => {
  it("reads every page and maps the stored profile", async () => {
    const kv = makeKv(
      {
        "newsletter:atlanta:a@example.com": subscriber("a@example.com", "atlanta"),
        "newsletter:atlanta:b@example.com": subscriber("b@example.com", "atlanta"),
        "newsletter:miami:c@example.com": subscriber("c@example.com", "miami"),
      },
      2,
    );
    const found = await listSubscribers(kv);
    expect(found.map((s) => s.email)).toEqual([
      "a@example.com",
      "b@example.com",
      "c@example.com",
    ]);
    expect(found[0]).toMatchObject({
      metroId: "atlanta",
      profile: { ageBands: ["3-5"], interests: ["animals"] },
    });
  });

  it("skips malformed and half-written records", async () => {
    const kv = makeKv({
      "newsletter:atlanta:good@example.com": subscriber("good@example.com", "atlanta"),
      "newsletter:atlanta:broken@example.com": "{not json",
      "newsletter:atlanta:noemail@example.com": JSON.stringify({ metroId: "atlanta" }),
      "newsletter:atlanta:nometro@example.com": JSON.stringify({ email: "x@example.com" }),
    });
    const found = await listSubscribers(kv);
    expect(found.map((s) => s.email)).toEqual(["good@example.com"]);
  });
});

describe("runScheduledDigest", () => {
  it("is a no-op while NEWSLETTER_ENABLED is off", async () => {
    let called = false;
    const result = await runScheduledDigest(
      {
        POLLS: makeKv({}),
        RESEND_API_KEY: "stub-key",
      },
      (async () => {
        called = true;
        return new Response("{}", { status: 200 });
      }) as typeof fetch,
    );
    expect(result).toMatchObject({ ok: true, count: 0, skipped: "disabled" });
    expect(called).toBe(false);
  });

  it("sends one digest per subscriber with a weekday forecast lead", async () => {
    const kv = makeKv({
      "newsletter:atlanta:a@example.com": subscriber("a@example.com", "atlanta"),
      "newsletter:miami:b@example.com": subscriber("b@example.com", "miami"),
    });
    const sent: Array<Record<string, unknown> & { to: string[] }> = [];
    const stubFetch: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/data/") && url.endsWith("featured-plans.json")) {
        return new Response(JSON.stringify({ plans: [] }), { status: 200 });
      }
      if (url.includes("/data/") && url.endsWith("events.json")) {
        // A wet Saturday fixture: one outdoor festival, one indoor museum day.
        return new Response(
          JSON.stringify({
            events: [
              {
                id: "evt-park",
                title: "Riverside Park Festival",
                venue: "Riverside Park",
                category: "Festival",
                startDateTime: "2026-05-23T18:00:00.000Z",
              },
              {
                id: "evt-museum",
                title: "Dinosaur Museum Day",
                venue: "Science Museum",
                category: "Museum",
                cost: "Free",
                startDateTime: "2026-05-23T19:00:00.000Z",
              },
            ],
          }),
          { status: 200 },
        );
      }
      if (url.startsWith("https://api.open-meteo.com/")) {
        // Thu 2026-05-21 → Sat 5/23 wet, Sun 5/24 dry.
        return new Response(
          JSON.stringify({
            daily: {
              time: ["2026-05-21", "2026-05-22", "2026-05-23", "2026-05-24"],
              weathercode: [3, 3, 61, 0],
              temperature_2m_max: [70, 70, 66, 75],
              temperature_2m_min: [55, 55, 54, 56],
              precipitation_probability_max: [10, 20, 80, 5],
            },
          }),
          { status: 200 },
        );
      }
      if (url === "https://api.resend.com/emails" && init?.body) {
        sent.push(JSON.parse(String(init.body)) as Record<string, unknown> & { to: string[] });
        return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };

    const result = await runScheduledDigest(
      {
        POLLS: kv,
        NEWSLETTER_ENABLED: "true",
        RESEND_API_KEY: "stub-key",
        // Also the unsubscribe-link HMAC key when UNSUBSCRIBE_SECRET is unset.
        NEWSLETTER_ADMIN_TOKEN: "stub-token",
      },
      stubFetch,
    );

    expect(result).toMatchObject({ ok: true, count: 2 });
    expect(sent.map((m) => m.to[0]).sort()).toEqual(["a@example.com", "b@example.com"]);
    // Weather-driven lead reaches the body, and the unsubscribe link points
    // at the worker (a cron has no request origin to read).
    for (const message of sent) {
      expect(String(message.html)).toContain("Rain's likely Saturday");
      const headers = message.headers as Record<string, string> | undefined;
      expect(headers?.["List-Unsubscribe"]).toContain(
        `${DEFAULT_WORKER_ORIGIN}/newsletter/unsubscribe?email=`,
      );
    }
  });
});
