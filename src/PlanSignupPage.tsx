// Capture-first landing page for paid traffic: the ad promise is a
// deliverable, not a directory — "your family's weekend plan, in your
// inbox by Friday." One field, one CTA, three real teaser events for the
// visitor's metro as proof. The email rides the existing newsletter
// pipeline (profile-aware Friday digest + Monday recap), so every signup
// is a retention asset, not a dead click.
//
// Reachable at {metro}/#/plan-signup (hash route handled in main.tsx,
// mirroring PlanCardView). Standalone — no topbar, no feed, nothing to
// browse away from.

import { useEffect, useMemo, useState } from "react";
import { Check, Loader2, Mail } from "lucide-react";
import type { MetroConfig } from "./metros";
import type { FamilyEvent } from "./App";
import { subscribeNewsletter, trackMetric, API_CONFIGURED } from "./api";
import { APP_BRAND, APP_DOMAIN } from "./appConfig";
import { eventImageSmall } from "./eventImages";
import { isFeedJunkEvent } from "./eventQuality";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Same data origin pattern as App.tsx (VITE_DATA_ORIGIN → famhop-data in
// production, same-origin in dev). Not imported from App to avoid a cycle.
const DATA_ORIGIN = (import.meta.env.VITE_DATA_ORIGIN ?? "").replace(/\/$/, "");

const MARQUEE_RE =
  /\b(festival|fest|parade|fireworks|carnival|fair|circus|rodeo|air ?show|balloon|drone show|block party|grand opening)\b/i;
const BIG_DRAW_RE =
  /\b(concert|live music|symphony|orchestra|movie night|outdoor movie|zoo|aquarium|splash|water play|pumpkin|holiday lights|ice skating|kite|dinosaur|magic show|puppet)\b/i;
const ROUTINE_RE =
  /\b(storytime|story time|story hour|book club|lego club|toddler time|craft|homework help|chess club)\b/i;

// Mirrors the newsletter's interestingness scoring — enough to pick three
// genuinely appealing teasers from the weekend window.
function teaserScore(event: FamilyEvent): number {
  const title = event.title || "";
  let score = 0;
  if (MARQUEE_RE.test(title)) score += 5;
  if (BIG_DRAW_RE.test(title)) score += 3;
  if (event.cost === "Free") score += 2;
  if (ROUTINE_RE.test(title)) score -= 3;
  return score;
}

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Sat + Sun of this weekend, in the metro's timezone (zoned via UTC offset
// math on the metro's offset — the timezone string is only used for the
// window keys, so this stays simple).
function weekendKeys(now: Date, timezone: string): { sat: string; sun: string } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value || "";
  const localNow = new Date(`${get("year")}-${get("month")}-${get("day")}T12:00:00`);
  const dow = localNow.getDay();
  const daysToSat = dow === 6 ? 0 : (6 - dow + 7) % 7;
  const sat = new Date(localNow);
  sat.setDate(localNow.getDate() + daysToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return { sat: dateKey(sat), sun: dateKey(sun) };
}

function pickTeasers(
  events: FamilyEvent[],
  now: Date,
  timezone: string,
): FamilyEvent[] {
  const { sat, sun } = weekendKeys(now, timezone);
  const seen = new Set<string>();
  const candidates: FamilyEvent[] = [];
  for (const event of events) {
    if (!event.startDateTime) continue;
    if (isFeedJunkEvent(event)) continue;
    const start = new Date(event.startDateTime);
    if (Number.isNaN(start.getTime()) || start.getTime() < now.getTime()) continue;
    const key = dateKey(start);
    if (key !== sat && key !== sun) continue;
    const dupeKey = `${event.title.toLowerCase()}|${(event.venue || "").toLowerCase()}`;
    if (seen.has(dupeKey)) continue;
    seen.add(dupeKey);
    candidates.push(event);
  }
  candidates.sort((a, b) => {
    const diff = teaserScore(b) - teaserScore(a);
    if (diff !== 0) return diff;
    return (
      (Date.parse(a.startDateTime || "") || 0) -
      (Date.parse(b.startDateTime || "") || 0)
    );
  });
  return candidates.slice(0, 3);
}

type Props = {
  metro: MetroConfig;
};

export default function PlanSignupPage({ metro }: Props) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);
  const [teasers, setTeasers] = useState<FamilyEvent[]>([]);

  useEffect(() => {
    let cancelled = false;
    const url = `${DATA_ORIGIN}/data/${metro.dataDir}/events.json`;
    fetch(url)
      .then((r) => (r.ok ? r.json() : null))
      .then((doc: { events?: FamilyEvent[] } | null) => {
        if (cancelled || !doc?.events) return;
        setTeasers(pickTeasers(doc.events, new Date(), metro.timezone));
      })
      .catch(() => {
        // teasers are decorative — the page still works without them
      });
    return () => {
      cancelled = true;
    };
  }, [metro]);

  // OG meta so the shared landing URL unfurls like a product page.
  useEffect(() => {
    const title = `Your family's weekend plan, in your inbox by Friday | ${APP_BRAND}`;
    const description = `Real ${metro.label} events for kids, ranked by age, emailed every Friday — plus a Monday check-in. Free, no spam.`;
    const prevTitle = document.title;
    document.title = title;
    const setMeta = (selector: string, kind: "property" | "name", content: string) => {
      const el = document.head.querySelector<HTMLMetaElement>(selector);
      if (el) el.setAttribute("content", content);
      else {
        const meta = document.createElement("meta");
        meta.setAttribute(kind, selector.split("=")[1].replace(/[^\w.:-]/g, ""));
        meta.setAttribute("content", content);
        document.head.appendChild(meta);
      }
    };
    setMeta('meta[property="og:title"]', "property", title);
    setMeta('meta[property="og:description"]', "property", description);
    setMeta('meta[name="twitter:title"]', "name", title);
    setMeta('meta[name="twitter:description"]', "name", description);
    return () => {
      document.title = prevTitle;
    };
  }, [metro]);

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email.");
      return;
    }
    setError(null);
    setStatus("submitting");
    // The kids' age band rides along when a returning visitor has one, so
    // the digest ranks picks for their family (worker stores it on the
    // subscriber record).
    let storedAge: string | undefined;
    try {
      const raw = window.localStorage.getItem("famhop:ageBand");
      if (raw && raw !== "any") storedAge = raw;
    } catch {
      // ignore
    }
    subscribeNewsletter({
      email: trimmed,
      metroId: metro.id,
      ageBand: storedAge,
      source: "ad-landing",
      url: window.location.href,
    })
      .then(() => {
        setStatus("done");
        trackMetric("newsletter_subscribed", metro.id);
      })
      .catch((e) => {
        setStatus("error");
        setError((e as Error).message || "Subscribe failed — try again.");
      });
  }

  return (
    <main className="plan-signup">
      <section className="plan-signup-card">
        <p className="plan-signup-brand">{APP_BRAND}</p>
        <h1>
          Your family&rsquo;s weekend plan,
          <br />
          <em>in your inbox by Friday.</em>
        </h1>
        <p className="plan-signup-sub">
          Real {metro.label} events for kids — ranked by age, checked against
          the organizer&rsquo;s own calendar. One email Friday, one check-in
          Monday. Free, no spam.
        </p>

        {status === "done" ? (
          <div className="plan-signup-success" role="status">
            <Check aria-hidden="true" />
            <strong>You&rsquo;re in!</strong>
            <span>
              Your first plan lands Friday morning. We&rsquo;ll see you Monday
              with a recap too.
            </span>
          </div>
        ) : (
          <form className="plan-signup-form" onSubmit={submit}>
            <label htmlFor="plan-signup-email">Email address</label>
            <div className="plan-signup-form-row">
              <input
                id="plan-signup-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={status === "submitting"}
              />
              <button
                type="submit"
                className="primary-button"
                disabled={status === "submitting" || !API_CONFIGURED}
              >
                {status === "submitting" ? (
                  <Loader2 className="spin" aria-hidden="true" />
                ) : (
                  <Mail aria-hidden="true" />
                )}
                Get my weekend plan
              </button>
            </div>
            {error && <p className="plan-signup-error">{error}</p>}
            <p className="plan-signup-note">
              Free · Unsubscribe anytime · No spam, ever
            </p>
          </form>
        )}

        {teasers.length > 0 && (
          <div className="plan-signup-teasers">
            <p className="plan-signup-teasers-label">
              This weekend in {metro.label}:
            </p>
            <ul>
              {teasers.map((event) => (
                <li key={event.id}>
                  <img src={eventImageSmall(event)} alt="" loading="lazy" />
                  <div>
                    <strong>{event.title}</strong>
                    <span>
                      {event.venue}
                      {event.city ? ` · ${event.city}` : ""}
                      {event.cost === "Free" ? " · Free" : ""}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}

        <p className="plan-signup-foot">
          Trusted picks every week — <a href={`https://${APP_DOMAIN}`}>{APP_DOMAIN}</a>
        </p>
      </section>
    </main>
  );
}
