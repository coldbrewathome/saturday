// Weekly digest send pipeline. Calls Resend HTTP API per-recipient
// (no SDK) — see docs/decisions/01-newsletter-provider.md. Renders
// per-metro HTML/text via renderWeekendDigest after fetching the same
// JSON the React app reads (featured-plans.json + events.json) from
// the famhop-data Pages origin.

import {
  renderWeekendDigest,
  type DigestEvent,
  type DigestOutput,
  type DigestPlan,
} from "./newsletter-template";

export type NewsletterRecipient = {
  email: string;
  metroId?: string;
  ageBand?: string;
};

export type SendWeekendDigestResult = {
  ok: true;
  count: number;
  failed?: number;
  skipped?: string;
  errors?: Array<{ email: string; status: number; message: string }>;
};

interface NewsletterEnv {
  NEWSLETTER_ENABLED?: string;
  RESEND_API_KEY?: string;
  // Override the data origin (defaults to famhop-data.pages.dev). Useful
  // for staging/test sends against a non-prod data bucket.
  NEWSLETTER_DATA_ORIGIN?: string;
  // Override the site origin used for plan deep-links (defaults to
  // https://famhop.com). Same shape as the React app's DATA_ORIGIN.
  NEWSLETTER_SITE_ORIGIN?: string;
}

const RESEND_ENDPOINT = "https://api.resend.com/emails";
const FROM_ADDRESS = "FamHop Weekend <weekly@famhop.com>";
const REPLY_TO = "hello@famhop.com";
const DEFAULT_DATA_ORIGIN = "https://famhop-data.pages.dev";
const DEFAULT_SITE_ORIGIN = "https://famhop.com";

// Metros we support sending to. Mirrors data/metros.json (id, label,
// timezone) — kept inline because the worker has no build step and
// can't read the JSON at deploy time. Add new metros here when they
// graduate to the public list.
const METROS: Record<string, { label: string; timezone: string }> = {
  "bay-area": { label: "Bay Area", timezone: "America/Los_Angeles" },
  "los-angeles": { label: "Los Angeles", timezone: "America/Los_Angeles" },
  "new-york-city": { label: "New York City", timezone: "America/New_York" },
  "seattle": { label: "Seattle", timezone: "America/Los_Angeles" },
  "chicago": { label: "Chicago", timezone: "America/Chicago" },
  "dallas-fort-worth": { label: "Dallas-Fort Worth", timezone: "America/Chicago" },
  "houston": { label: "Houston", timezone: "America/Chicago" },
  "washington-dc": { label: "Washington DC", timezone: "America/New_York" },
  "atlanta": { label: "Atlanta", timezone: "America/New_York" },
  "philadelphia": { label: "Philadelphia", timezone: "America/New_York" },
  "miami": { label: "Miami", timezone: "America/New_York" },
  "phoenix": { label: "Phoenix", timezone: "America/Phoenix" },
  "boston": { label: "Boston", timezone: "America/New_York" },
  "san-diego": { label: "San Diego", timezone: "America/Los_Angeles" },
  "honolulu": { label: "Honolulu", timezone: "Pacific/Honolulu" },
};

// Hook for tests to swap the fetch implementation. Production always
// passes through to the platform fetch.
export type FetchLike = typeof fetch;

export async function sendWeekendDigest(
  env: NewsletterEnv,
  recipients: NewsletterRecipient[],
  fetchImpl: FetchLike = fetch,
): Promise<SendWeekendDigestResult> {
  if (env.NEWSLETTER_ENABLED !== "true") {
    console.log("[newsletter] send skipped (NEWSLETTER_ENABLED!=true)", {
      count: recipients.length,
    });
    return { ok: true, count: 0, skipped: "disabled" };
  }
  if (!env.RESEND_API_KEY) {
    console.log("[newsletter] send skipped (RESEND_API_KEY not set)", {
      count: recipients.length,
    });
    return { ok: true, count: 0, skipped: "no-api-key" };
  }

  const dataOrigin = (env.NEWSLETTER_DATA_ORIGIN || DEFAULT_DATA_ORIGIN).replace(
    /\/$/,
    "",
  );
  const siteOrigin = (env.NEWSLETTER_SITE_ORIGIN || DEFAULT_SITE_ORIGIN).replace(
    /\/$/,
    "",
  );

  // Group recipients by metroId. Recipients without a known metroId are
  // skipped with an error attribution so the operator can see them in
  // the response (they need a metro to build a digest from).
  const byMetro = new Map<string, NewsletterRecipient[]>();
  const errors: Array<{ email: string; status: number; message: string }> = [];
  for (const recipient of recipients) {
    const metroId = recipient.metroId || "";
    if (!METROS[metroId]) {
      errors.push({
        email: recipient.email,
        status: 0,
        message: `unknown metroId: ${metroId || "(missing)"}`,
      });
      continue;
    }
    const list = byMetro.get(metroId) || [];
    list.push(recipient);
    byMetro.set(metroId, list);
  }

  let sent = 0;
  for (const [metroId, metroRecipients] of byMetro) {
    let digest: DigestOutput;
    try {
      digest = await buildMetroDigest(metroId, dataOrigin, siteOrigin, fetchImpl);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err).slice(0, 200);
      for (const recipient of metroRecipients) {
        errors.push({ email: recipient.email, status: 0, message });
      }
      continue;
    }

    for (const recipient of metroRecipients) {
      const res = await fetchImpl(RESEND_ENDPOINT, {
        method: "POST",
        headers: {
          authorization: `Bearer ${env.RESEND_API_KEY}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          from: FROM_ADDRESS,
          to: [recipient.email],
          reply_to: REPLY_TO,
          subject: digest.subject,
          html: digest.html,
          text: digest.text,
        }),
      });
      if (res.ok) {
        sent += 1;
      } else {
        let message = "";
        try {
          message = (await res.text()).slice(0, 200);
        } catch {
          // swallow — best-effort error capture
        }
        errors.push({ email: recipient.email, status: res.status, message });
      }
    }
  }

  if (errors.length > 0) {
    console.log("[newsletter] send completed with errors", {
      sent,
      failed: errors.length,
      sample: errors.slice(0, 3),
    });
    return { ok: true, count: sent, failed: errors.length, errors };
  }
  console.log("[newsletter] send ok", { sent });
  return { ok: true, count: sent };
}

async function buildMetroDigest(
  metroId: string,
  dataOrigin: string,
  siteOrigin: string,
  fetchImpl: FetchLike,
): Promise<DigestOutput> {
  const meta = METROS[metroId];
  const [plans, events] = await Promise.all([
    fetchJsonArray<DigestPlan>(
      `${dataOrigin}/data/${metroId}/featured-plans.json`,
      "plans",
      fetchImpl,
    ),
    fetchJsonArray<DigestEvent>(
      `${dataOrigin}/data/${metroId}/events.json`,
      "events",
      fetchImpl,
    ),
  ]);
  return renderWeekendDigest({
    metroId,
    metroLabel: meta.label,
    timezone: meta.timezone,
    plans,
    events,
    siteBaseUrl: siteOrigin,
  });
}

async function fetchJsonArray<T>(
  url: string,
  key: "plans" | "events",
  fetchImpl: FetchLike,
): Promise<T[]> {
  const res = await fetchImpl(url);
  if (!res.ok) {
    throw new Error(`fetch ${url} failed (${res.status})`);
  }
  const doc = (await res.json()) as Record<string, unknown>;
  const arr = doc?.[key];
  return Array.isArray(arr) ? (arr as T[]) : [];
}
