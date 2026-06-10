import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  buildUnsubscribeUrl,
  parseAllowlist,
  sendWeekendDigest,
  unsubscribeToken,
  type NewsletterRecipient,
} from "../worker/src/newsletter";

describe("parseAllowlist", () => {
  it("returns null for unset or empty input", () => {
    expect(parseAllowlist(undefined)).toBeNull();
    expect(parseAllowlist("")).toBeNull();
    expect(parseAllowlist("   ")).toBeNull();
    expect(parseAllowlist(",,")).toBeNull();
  });

  it("lowercases and trims entries", () => {
    const set = parseAllowlist("  Ops@Famhop.com , Other@Example.com ");
    expect(set).not.toBeNull();
    expect(set!.has("ops@famhop.com")).toBe(true);
    expect(set!.has("other@example.com")).toBe(true);
    expect(set!.size).toBe(2);
  });

  it("drops entries that don't look like emails", () => {
    const set = parseAllowlist("ok@x.com, not-an-email, also-bad");
    expect(set).not.toBeNull();
    expect(set!.size).toBe(1);
    expect(set!.has("ok@x.com")).toBe(true);
  });
});

describe("sendWeekendDigest allowlist gate", () => {
  // Stub fetch so the test never touches the network. Captures payloads
  // for assertions on who got sent to.
  function makeStubFetch() {
    const sentTo: string[] = [];
    const sentBodies: Array<Record<string, unknown>> = [];
    const fetchImpl = async (input: RequestInfo | URL): Promise<Response> => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/data/atlanta/featured-plans.json")) {
        return new Response(JSON.stringify({ plans: [] }), { status: 200 });
      }
      if (url.includes("/data/atlanta/events.json")) {
        return new Response(JSON.stringify({ events: [] }), { status: 200 });
      }
      if (url === "https://api.resend.com/emails") {
        // not reached in this test, but keep a placeholder
        return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
      }
      return new Response("not found", { status: 404 });
    };
    // Intercept the resend POST to capture recipients.
    const wrapped: typeof fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url === "https://api.resend.com/emails" && init?.body) {
        try {
          const body = JSON.parse(String(init.body));
          if (Array.isArray(body.to)) sentTo.push(...body.to);
          sentBodies.push(body);
        } catch {
          // ignore
        }
        return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
      }
      return fetchImpl(input);
    };
    return { fetch: wrapped, sentTo, sentBodies };
  }

  it("filters recipients not on NEWSLETTER_TEST_ALLOWLIST and attributes the drop", async () => {
    const { fetch: stubFetch, sentTo } = makeStubFetch();
    const recipients: NewsletterRecipient[] = [
      { email: "ops@famhop.com", metroId: "atlanta" },
      { email: "stranger@example.com", metroId: "atlanta" },
    ];
    const result = await sendWeekendDigest(
      {
        NEWSLETTER_ENABLED: "true",
        RESEND_API_KEY: "stub-key",
        NEWSLETTER_TEST_ALLOWLIST: "ops@famhop.com",
      },
      recipients,
      stubFetch,
    );

    expect(result.ok).toBe(true);
    expect(result.count).toBe(1);
    expect(sentTo).toEqual(["ops@famhop.com"]);
    expect(result.failed).toBe(1);
    expect(result.errors?.[0]).toMatchObject({
      email: "stranger@example.com",
      message: "filtered by NEWSLETTER_TEST_ALLOWLIST",
    });
  });

  it("is case-insensitive on the recipient email vs. the allowlist", async () => {
    const { fetch: stubFetch, sentTo } = makeStubFetch();
    const result = await sendWeekendDigest(
      {
        NEWSLETTER_ENABLED: "true",
        RESEND_API_KEY: "stub-key",
        NEWSLETTER_TEST_ALLOWLIST: "ops@famhop.com",
      },
      [{ email: "OPS@Famhop.COM", metroId: "atlanta" }],
      stubFetch,
    );
    expect(result.count).toBe(1);
    expect(sentTo).toEqual(["OPS@Famhop.COM"]);
    expect(result.failed).toBeUndefined();
  });

  it("does not filter when allowlist env is unset", async () => {
    const { fetch: stubFetch, sentTo } = makeStubFetch();
    const result = await sendWeekendDigest(
      {
        NEWSLETTER_ENABLED: "true",
        RESEND_API_KEY: "stub-key",
      },
      [{ email: "anyone@example.com", metroId: "atlanta" }],
      stubFetch,
    );
    expect(result.count).toBe(1);
    expect(sentTo).toEqual(["anyone@example.com"]);
  });

  it("adds per-recipient unsubscribe footer + List-Unsubscribe headers when a base URL and secret are set", async () => {
    const { fetch: stubFetch, sentBodies } = makeStubFetch();
    const result = await sendWeekendDigest(
      {
        NEWSLETTER_ENABLED: "true",
        RESEND_API_KEY: "stub-key",
        // No UNSUBSCRIBE_SECRET — falls back to the admin token as HMAC key.
        NEWSLETTER_ADMIN_TOKEN: "admin-token",
      },
      [{ email: "ops@famhop.com", metroId: "atlanta" }],
      stubFetch,
      "https://saturday-polls.example.workers.dev",
    );
    expect(result.count).toBe(1);
    const expectedUrl = await buildUnsubscribeUrl(
      "https://saturday-polls.example.workers.dev",
      "ops@famhop.com",
      "admin-token",
    );
    const body = sentBodies[0];
    expect(body.headers).toEqual({
      "List-Unsubscribe": `<${expectedUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(String(body.text)).toContain(`Unsubscribe: ${expectedUrl}`);
    expect(String(body.html)).toContain("Unsubscribe with one click");
  });

  it("omits List-Unsubscribe headers when no unsubscribe base URL is passed", async () => {
    const { fetch: stubFetch, sentBodies } = makeStubFetch();
    await sendWeekendDigest(
      {
        NEWSLETTER_ENABLED: "true",
        RESEND_API_KEY: "stub-key",
        NEWSLETTER_ADMIN_TOKEN: "admin-token",
      },
      [{ email: "ops@famhop.com", metroId: "atlanta" }],
      stubFetch,
    );
    expect(sentBodies[0].headers).toBeUndefined();
  });
});

describe("unsubscribe link helpers", () => {
  it("unsubscribeToken is the hex HMAC-SHA256 of the lowercased email", async () => {
    const expected = createHmac("sha256", "s3cret")
      .update("ops@famhop.com")
      .digest("hex");
    expect(await unsubscribeToken("OPS@Famhop.com", "s3cret")).toBe(expected);
    expect(await unsubscribeToken("ops@famhop.com", "s3cret")).toBe(expected);
  });

  it("buildUnsubscribeUrl encodes the email and strips a trailing slash", async () => {
    const token = await unsubscribeToken("ops@famhop.com", "s3cret");
    const url = await buildUnsubscribeUrl(
      "https://polls.example.com/",
      "Ops@Famhop.com",
      "s3cret",
    );
    expect(url).toBe(
      `https://polls.example.com/newsletter/unsubscribe?email=ops%40famhop.com&token=${token}`,
    );
  });
});
