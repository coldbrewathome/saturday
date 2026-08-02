// Weekly digest send pipeline. Calls Resend HTTP API per-recipient
// (no SDK) — see docs/decisions/01-newsletter-provider.md. Renders
// per-metro HTML/text via renderWeekendDigest after fetching the same
// JSON the React app reads (featured-plans.json + events.json) from
// the famhop-data Pages origin.

import {
  lastWeekendWindow,
  renderMondayRecap,
  renderWeekendDigest,
  type DigestEvent,
  type DigestPlan,
  type SubscriberProfile,
} from "./newsletter-template";

export type NewsletterRecipient = {
  email: string;
  metroId?: string;
  ageBand?: string;
  /** Full family profile (from the in-app wizard) for personalized picks. */
  profile?: SubscriberProfile;
  /** Saved event ids at subscribe time — drives the Monday recap's
   * "did you go?" asks. */
  savedEventIds?: string[];
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
  // HMAC key for per-recipient unsubscribe tokens. Falls back to
  // NEWSLETTER_ADMIN_TOKEN so unsubscribe links work before the dedicated
  // secret is provisioned.
  UNSUBSCRIBE_SECRET?: string;
  NEWSLETTER_ADMIN_TOKEN?: string;
  // Override the data origin (defaults to famhop-data.pages.dev). Useful
  // for staging/test sends against a non-prod data bucket.
  NEWSLETTER_DATA_ORIGIN?: string;
  // Override the site origin used for plan deep-links (defaults to
  // https://famhop.com). Same shape as the React app's DATA_ORIGIN.
  NEWSLETTER_SITE_ORIGIN?: string;
  // Comma-separated email allowlist. When set (non-empty), recipients
  // not on the list are filtered out before sending. Used as a safety
  // gate for the first real operator test — set this to the operator's
  // address so a fat-fingered subscriber payload can't blast the list.
  NEWSLETTER_TEST_ALLOWLIST?: string;
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
export const METROS: Record<string, { label: string; timezone: string }> = {
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
  "austin": { label: "Austin", timezone: "America/Chicago" },
};

// Hook for tests to swap the fetch implementation. Production always
// passes through to the platform fetch.
export type FetchLike = typeof fetch;

export async function sendWeekendDigest(
  env: NewsletterEnv,
  recipients: NewsletterRecipient[],
  fetchImpl: FetchLike = fetch,
  // Origin (e.g. the worker's own URL) used to build per-recipient
  // unsubscribe links. When unset, footers fall back to "reply to opt out"
  // and no List-Unsubscribe headers are sent.
  unsubscribeBaseUrl?: string,
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

  // Optional allowlist gate. When NEWSLETTER_TEST_ALLOWLIST is set,
  // drop recipients whose lowercased email isn't on the list. The
  // first real test send uses this to scope blast radius to the
  // operator email even if the KV recipients dump is wider than
  // expected.
  const allowlist = parseAllowlist(env.NEWSLETTER_TEST_ALLOWLIST);
  const errors: Array<{ email: string; status: number; message: string }> = [];
  let filtered = recipients;
  if (allowlist) {
    filtered = [];
    for (const recipient of recipients) {
      if (allowlist.has(recipient.email.toLowerCase())) {
        filtered.push(recipient);
      } else {
        errors.push({
          email: recipient.email,
          status: 0,
          message: "filtered by NEWSLETTER_TEST_ALLOWLIST",
        });
      }
    }
  }

  // Group recipients by metroId. Recipients without a known metroId are
  // skipped with an error attribution so the operator can see them in
  // the response (they need a metro to build a digest from).
  const byMetro = new Map<string, NewsletterRecipient[]>();
  for (const recipient of filtered) {
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

  const unsubscribeSecret = env.UNSUBSCRIBE_SECRET || env.NEWSLETTER_ADMIN_TOKEN;

  let sent = 0;
  for (const [metroId, metroRecipients] of byMetro) {
    const meta = METROS[metroId];
    let plans: DigestPlan[];
    let events: DigestEvent[];
    try {
      [plans, events] = await Promise.all([
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
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err).slice(0, 200);
      for (const recipient of metroRecipients) {
        errors.push({ email: recipient.email, status: 0, message });
      }
      continue;
    }

    for (const recipient of metroRecipients) {
      // Per-recipient render: the unsubscribe link carries an HMAC of the
      // recipient's email, so the footer differs for every recipient.
      const unsubscribeUrl =
        unsubscribeBaseUrl && unsubscribeSecret
          ? await buildUnsubscribeUrl(
              unsubscribeBaseUrl,
              recipient.email,
              unsubscribeSecret,
            )
          : undefined;
      const digest = renderWeekendDigest({
        metroId,
        metroLabel: meta.label,
        timezone: meta.timezone,
        plans,
        events,
        siteBaseUrl: siteOrigin,
        unsubscribeUrl,
        profile: recipient.profile,
      });
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
          ...(unsubscribeUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
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

// KV reader for check-in aggregates (passed by the worker's own handler so
// this pipeline stays testable without a KV binding). Null disables the
// "what other families loved" section.
export type KvGetter = (key: string) => Promise<string | null>;

export async function sendMondayRecap(
  env: NewsletterEnv,
  recipients: NewsletterRecipient[],
  fetchImpl: FetchLike = fetch,
  unsubscribeBaseUrl?: string,
  kv?: KvGetter | null,
): Promise<SendWeekendDigestResult> {
  if (env.NEWSLETTER_ENABLED !== "true") {
    return { ok: true, count: 0, skipped: "disabled" };
  }
  if (!env.RESEND_API_KEY) {
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
  const allowlist = parseAllowlist(env.NEWSLETTER_TEST_ALLOWLIST);
  const errors: Array<{ email: string; status: number; message: string }> = [];
  let filtered = recipients;
  if (allowlist) {
    filtered = recipients.filter((r) => allowlist.has(r.email.toLowerCase()));
  }

  const byMetro = new Map<string, NewsletterRecipient[]>();
  for (const recipient of filtered) {
    const metroId = recipient.metroId || "";
    if (!METROS[metroId]) continue;
    const list = byMetro.get(metroId) || [];
    list.push(recipient);
    byMetro.set(metroId, list);
  }

  const unsubscribeSecret = env.UNSUBSCRIBE_SECRET || env.NEWSLETTER_ADMIN_TOKEN;
  const now = new Date();
  let sent = 0;

  for (const [metroId, metroRecipients] of byMetro) {
    const meta = METROS[metroId];
    let events: DigestEvent[];
    try {
      events = await fetchJsonArray<DigestEvent>(
        `${dataOrigin}/data/${metroId}/events.json`,
        "events",
        fetchImpl,
      );
    } catch (err) {
      const message =
        err instanceof Error ? err.message : String(err).slice(0, 200);
      for (const recipient of metroRecipients) {
        errors.push({ email: recipient.email, status: 0, message });
      }
      continue;
    }

    const byId = new Map(events.map((e) => [e.id, e]));
    const pastWeekend = lastWeekendWindow(now, meta.timezone);
    const upcomingWeekend = weekendWindowFor(now, meta.timezone);

    for (const recipient of metroRecipients) {
      const unsubscribeUrl =
        unsubscribeBaseUrl && unsubscribeSecret
          ? await buildUnsubscribeUrl(
              unsubscribeBaseUrl,
              recipient.email,
              unsubscribeSecret,
            )
          : undefined;

      // Saved events from the just-ended weekend (id matches only — the
      // events.json window has already aged them out if they're older).
      const savedEvents = (recipient.savedEventIds ?? [])
        .map((id) => byId.get(id))
        .filter((e): e is DigestEvent => Boolean(e))
        .filter((e) => {
          if (!e.startDateTime) return false;
          const key = zonedDateKeyOf(e.startDateTime, meta.timezone);
          return (
            key === pastWeekend.saturdayKey || key === pastWeekend.sundayKey
          );
        })
        .slice(0, 5);

      // Trust aggregates for the most-checked-in saved events (top 3 by
      // check-in count), when a KV reader is available.
      const trusted: Array<{ title: string; trustScore: number; url?: string }> = [];
      if (kv) {
        const scored: Array<{
          title: string;
          url?: string;
          trustScore: number;
          total: number;
        }> = [];
        for (const event of savedEvents) {
          const raw = await kv(`checkin:event:${event.id}`);
          if (!raw) continue;
          try {
            const agg = JSON.parse(raw) as { worthIt?: number; notWorthIt?: number };
            const worthIt = Number(agg.worthIt) || 0;
            const notWorthIt = Number(agg.notWorthIt) || 0;
            const total = worthIt + notWorthIt;
            if (total < 3) continue;
            scored.push({
              title: event.title,
              url: event.url,
              trustScore: Math.round((worthIt / total) * 100),
              total,
            });
          } catch {
            // corrupt aggregate — skip
          }
        }
        scored.sort((a, b) => b.total - a.total);
        trusted.push(...scored.slice(0, 3));
      }

      // Upcoming picks for the coming weekend: profile-ranked when the
      // recipient has a profile, generic interestingness otherwise.
      const upcomingEvents = upcomingWeekendEvents(
        events,
        upcomingWeekend,
        now,
        recipient.profile,
      );

      const recap = renderMondayRecap({
        metroId,
        metroLabel: meta.label,
        timezone: meta.timezone,
        savedEvents,
        trusted,
        upcoming: upcomingEvents,
        now,
        siteBaseUrl: siteOrigin,
        unsubscribeUrl,
      });

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
          subject: recap.subject,
          html: recap.html,
          text: recap.text,
          ...(unsubscribeUrl
            ? {
                headers: {
                  "List-Unsubscribe": `<${unsubscribeUrl}>`,
                  "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
                },
              }
            : {}),
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
    return { ok: true, count: sent, failed: errors.length, errors };
  }
  return { ok: true, count: sent };
}

// The upcoming weekend (Sat+Sun at-or-after now) — mirrors the digest window.
function weekendWindowFor(now: Date, timezone: string): DigestEventWindow {
  const today = zonedDatePartsOf(now, timezone);
  const dow = weekdayIndexOf(today.weekday);
  const daysToSat = dow === 6 ? 0 : (6 - dow + 7) % 7;
  const sat = addDays(today, daysToSat);
  const sun = addDays(sat, 1);
  return { saturdayKey: ymdOf(sat), sundayKey: ymdOf(sun), timezone };
}

type DigestEventWindow = {
  saturdayKey: string;
  sundayKey: string;
  timezone: string;
};

function upcomingWeekendEvents(
  events: DigestEvent[],
  window: DigestEventWindow,
  now: Date,
  profile?: SubscriberProfile,
): DigestEvent[] {
  const inWindow = events.filter((e) => {
    if (!e.startDateTime) return false;
    const key = zonedDateKeyOf(e.startDateTime, window.timezone);
    return key === window.saturdayKey || key === window.sundayKey;
  });
  const score = (e: DigestEvent): number => {
    let s = interestingness(e);
    if (profile) {
      const ageBands = profile.ageBands ?? [];
      if (ageBands.length > 0 && (e.ageBands ?? []).some((b) => ageBands.includes(b))) {
        s += 15;
      }
      const interests = profile.interests ?? [];
      const overlap = (e.themes ?? []).filter((t) => interests.includes(t)).length;
      s += Math.min(overlap, 2) * 8;
      if (profile.budget === "free" && e.cost && /free/i.test(e.cost)) s += 5;
    }
    return s;
  };
  return inWindow
    .sort((a, b) => {
      const diff = score(b) - score(a);
      if (diff !== 0) return diff;
      return (
        (Date.parse(a.startDateTime || "") || 0) -
        (Date.parse(b.startDateTime || "") || 0)
      );
    })
    .slice(0, 4);
}

// Minimal interestingness mirror (worker can't import the template's private
// scoreEvent) — marquee words up, routine library words down.
function interestingness(event: DigestEvent): number {
  const title = String(event.title || "");
  let s = 0;
  if (
    /\b(festival|fest|parade|fireworks|carnival|fair|circus|rodeo|air ?show|balloon|drone show|block party|grand opening)\b/i.test(
      title,
    )
  ) {
    s += 5;
  }
  if (
    /\b(concert|live music|symphony|orchestra|movie night|zoo|aquarium|splash|water play|pumpkin|holiday lights|ice skating|kite|dinosaur|magic show|puppet)\b/i.test(
      title,
    )
  ) {
    s += 3;
  }
  if (event.category && /fest|fair|music|outdoor|seasonal/i.test(event.category)) s += 2;
  if (event.cost && /free/i.test(event.cost)) s += 2;
  if (
    /\b(storytime|story time|story hour|book club|lego club|toddler time|craft|homework help|chess club)\b/i.test(
      title,
    )
  ) {
    s -= 3;
  }
  return s;
}

// ── Date helpers (local to this file; the template exports its own) ──────

function zonedDatePartsOf(
  date: Date,
  timeZone: string,
): { year: number; month: number; day: number; weekday: string } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value || "";
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    weekday: get("weekday"),
  };
}

function weekdayIndexOf(shortName: string): number {
  const n = String(shortName || "").slice(0, 3).toLowerCase();
  return ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].indexOf(n);
}

function addDays(
  ymd: { year: number; month: number; day: number },
  days: number,
): { year: number; month: number; day: number } {
  const d = new Date(Date.UTC(ymd.year, ymd.month - 1, ymd.day + days));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function ymdOf(ymd: { year: number; month: number; day: number }): string {
  return `${ymd.year}-${String(ymd.month).padStart(2, "0")}-${String(ymd.day).padStart(2, "0")}`;
}

function zonedDateKeyOf(iso: string, timeZone: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return ymdOf(zonedDatePartsOf(date, timeZone));
}

// HMAC-SHA256 (hex) of the lowercased email. The unsubscribe endpoint in
// worker/src/index.ts recomputes this to verify the link wasn't forged.
export async function unsubscribeToken(
  email: string,
  secret: string,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(email.trim().toLowerCase()),
  );
  return Array.from(new Uint8Array(signature))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Builds the GET /newsletter/unsubscribe link embedded in digest footers
// and List-Unsubscribe headers.
export async function buildUnsubscribeUrl(
  baseUrl: string,
  email: string,
  secret: string,
): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const token = await unsubscribeToken(normalized, secret);
  return `${baseUrl.replace(/\/$/, "")}/newsletter/unsubscribe?email=${encodeURIComponent(normalized)}&token=${token}`;
}

// Exported for unit tests. Returns null when the env var is unset
// or contains no valid entries (allowlist disabled). Otherwise a Set
// of lowercased emails.
export function parseAllowlist(raw: string | undefined): Set<string> | null {
  if (!raw) return null;
  const entries = raw
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0 && s.includes("@"));
  if (entries.length === 0) return null;
  return new Set(entries);
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
