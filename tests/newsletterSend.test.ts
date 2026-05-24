import { describe, expect, it } from "vitest";
import {
  parseAllowlist,
  sendWeekendDigest,
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
        } catch {
          // ignore
        }
        return new Response(JSON.stringify({ id: "stub" }), { status: 200 });
      }
      return fetchImpl(input);
    };
    return { fetch: wrapped, sentTo };
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
});
