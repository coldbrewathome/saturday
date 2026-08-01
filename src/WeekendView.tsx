// Decision-first weekend home — the "Weekend" tab and the kids-brand default
// landing view. The browse map answers "what's everywhere"; this view answers
// the question a parent actually arrives with: "what are we doing Saturday?"
// Events are laid out as Saturday/Sunday sub-grouped by morning/afternoon/
// evening — the nap-schedule units families plan in — and scoped by the same
// persisted age band as the map filter.

import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronRight,
  MapPin,
  Plus,
  Share2,
  Sparkles,
} from "lucide-react";
import type { FamilyEvent, FeaturedPlan } from "./App";
import type { MetroConfig } from "./metros";
import type { AgeBand } from "./planner";
import { APP_AUDIENCE, SHOW_AGE_BAND_UI } from "./appConfig";
import { isUpcomingEvent } from "./eventFreshness";

// Local copy of App.tsx's sourceHostname — importing the runtime helper from
// App would create a require cycle (App imports this view).
function sourceHostname(url: string): string | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host || null;
  } catch {
    return null;
  }
}

const AGE_CHIPS: ReadonlyArray<readonly [AgeBand, string]> = [
  ["toddler", "0–2"],
  ["preschool", "3–5"],
  ["school-age", "6–10"],
  ["tween", "10+"],
];

const DAYPARTS = ["Morning", "Afternoon", "Evening"] as const;

// Per-day cap keeps the feed a decision, not an inventory; overflow exits to
// the map where the full inventory belongs.
const DAY_CAP = 8;

function dateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

// Same Sat/Sun math as the browse view's weekend banner: on Sunday the
// "weekend" is yesterday+today so the feed never points at a dead Saturday.
function upcomingWeekend(now: Date): { sat: Date; sun: Date } {
  const dow = now.getDay();
  const daysToSat = dow === 0 ? -1 : 6 - dow;
  const sat = new Date(now);
  sat.setHours(0, 0, 0, 0);
  sat.setDate(now.getDate() + daysToSat);
  const sun = new Date(sat);
  sun.setDate(sat.getDate() + 1);
  return { sat, sun };
}

function timeLabel(event: FamilyEvent): string {
  if (event.startDateTime) {
    const d = new Date(event.startDateTime);
    if (Number.isFinite(d.getTime()) && (d.getHours() !== 0 || d.getMinutes() !== 0)) {
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    }
  }
  return event.timeWindow;
}

type Props = {
  events: FamilyEvent[];
  metro: MetroConfig;
  ageBand: AgeBand | "any";
  onAgeBand: (band: AgeBand | "any") => void;
  savedEventIds: string[];
  onToggleSaved: (id: string) => void;
  /** Event ids already in the active plan (for the "in plan" state). */
  planEventIds: string[];
  /** Add this event to the active plan, or seed a new plan with it. */
  onAddToPlan: (eventId: string) => void;
  /** One-tap share (native share sheet / clipboard) for this event. */
  onShare: (title: string, slug: string) => void;
  featuredPlans: FeaturedPlan[];
  onUsePlan: (plan: FeaturedPlan) => void;
  onOpenMap: () => void;
  /** Static per-metro weekend guide (city pages, printable). */
  guideHref: string;
  /** NewsletterCard is injected by App to avoid an import cycle. */
  newsletterSlot?: ReactNode;
};

export default function WeekendView({
  events,
  metro,
  ageBand,
  onAgeBand,
  savedEventIds,
  onToggleSaved,
  planEventIds,
  onAddToPlan,
  onShare,
  featuredPlans,
  onUsePlan,
  onOpenMap,
  guideHref,
  newsletterSlot,
}: Props) {
  const feed = useMemo(() => {
    const now = new Date();
    const { sat, sun } = upcomingWeekend(now);
    const satKey = dateKey(sat);
    const sunKey = dateKey(sun);
    const byDay = new Map<string, FamilyEvent[]>([
      [satKey, []],
      [sunKey, []],
    ]);
    // Ticketed feeds emit one record per timed slot — collapse to one card
    // per (title, venue, day), keeping the earliest start.
    const seen = new Set<string>();
    const dated = events
      .filter(
        (e) =>
          e.startDateTime &&
          isUpcomingEvent(e, now, { timeZone: metro.timezone }),
      )
      .sort((a, b) => (a.startDateTime! < b.startDateTime! ? -1 : 1));
    for (const event of dated) {
      const d = new Date(event.startDateTime!);
      if (!Number.isFinite(d.getTime())) continue;
      const k = dateKey(d);
      const bucket = byDay.get(k);
      if (!bucket) continue;
      const dupeKey = `${event.title.toLowerCase()}|${(event.venue || event.neighborhood || "").toLowerCase()}|${k}`;
      if (seen.has(dupeKey)) continue;
      seen.add(dupeKey);
      bucket.push(event);
    }
    return {
      sat,
      sun,
      satEvents: byDay.get(satKey)!,
      sunEvents: byDay.get(sunKey)!,
    };
  }, [events, metro]);

  const scope = (list: FamilyEvent[]) =>
    ageBand === "any" ? list : list.filter((e) => e.ageBands.includes(ageBand));
  const satScoped = scope(feed.satEvents);
  const sunScoped = scope(feed.sunEvents);
  const total = satScoped.length + sunScoped.length;
  const freeCount =
    satScoped.filter((e) => e.cost === "Free").length +
    sunScoped.filter((e) => e.cost === "Free").length;
  const ageLabel =
    ageBand === "any"
      ? null
      : AGE_CHIPS.find(([band]) => band === ageBand)?.[1] ?? null;

  const rangeLabel = `${feed.sat.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}–${feed.sun.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  })}`;

  function renderCard(event: FamilyEvent) {
    const saved = savedEventIds.includes(event.id);
    const inPlan = planEventIds.includes(event.id);
    const host =
      event.verified && event.url ? sourceHostname(event.url) : null;
    const free = event.cost === "Free";
    const showCost = !free && event.cost && event.cost !== "Unknown";
    return (
      <li key={event.id} className="weekend-card">
        <span className="weekend-card-when">{timeLabel(event)}</span>
        <div className="weekend-card-main">
          {event.slug ? (
            <a
              className="weekend-card-title"
              href={`#/event/${encodeURIComponent(event.slug)}`}
            >
              {event.title}
            </a>
          ) : (
            <span className="weekend-card-title">{event.title}</span>
          )}
          <span className="weekend-card-where">
            {event.venue}
            {event.city ? ` · ${event.city}` : ""}
          </span>
          {(free || showCost || host) && (
            <span className="weekend-card-meta">
              {free && <em className="weekend-chip-free">Free</em>}
              {showCost && <em className="weekend-chip">{event.cost}</em>}
              {host && (
                <a
                  className="verified-source"
                  href={event.url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Verified · {host}
                </a>
              )}
            </span>
          )}
        </div>
        <div className="weekend-card-actions">
          <button
            type="button"
            className={`icon-button${saved ? " selected" : ""}`}
            title={saved ? "Saved — tap to remove" : "Save event"}
            aria-label={saved ? `Remove ${event.title} from saved` : `Save ${event.title}`}
            aria-pressed={saved}
            onClick={() => onToggleSaved(event.id)}
          >
            <Bookmark aria-hidden="true" />
          </button>
          <button
            type="button"
            className={`icon-button${inPlan ? " selected" : ""}`}
            title={inPlan ? "In your plan" : "Add to plan"}
            aria-label={
              inPlan
                ? `${event.title} is in your plan`
                : `Add ${event.title} to a plan`
            }
            onClick={() => {
              if (!inPlan) onAddToPlan(event.id);
            }}
          >
            {inPlan ? <Check aria-hidden="true" /> : <Plus aria-hidden="true" />}
          </button>
          {event.slug && (
            <button
              type="button"
              className="icon-button"
              title="Share event"
              aria-label={`Share ${event.title}`}
              onClick={() => onShare(event.title, event.slug!)}
            >
              <Share2 aria-hidden="true" />
            </button>
          )}
        </div>
      </li>
    );
  }

  function renderDay(date: Date, list: FamilyEvent[]) {
    const shown = list.slice(0, DAY_CAP);
    const overflow = list.length - shown.length;
    const parts = DAYPARTS.map((part) => ({
      part,
      items: shown.filter((e) => e.timeWindow === part),
    })).filter((group) => group.items.length > 0);
    const weekday = date.toLocaleDateString(undefined, { weekday: "long" });
    return (
      <section className="weekend-day" aria-label={`${weekday} events`}>
        <header className="weekend-day-head">
          <span className="weekend-day-num" aria-hidden="true">
            {date.getDate()}
          </span>
          <div className="weekend-day-name">
            <h2>{weekday}</h2>
            <p>
              {date.toLocaleDateString(undefined, {
                month: "long",
                day: "numeric",
              })}
            </p>
          </div>
        </header>
        {list.length === 0 ? (
          <p className="weekend-day-empty">
            Nothing dated for {weekday} yet. The map has recurring storytimes
            and open-run exhibits that work any day.
          </p>
        ) : (
          parts.map(({ part, items }) => (
            <div className="weekend-part" key={part}>
              <h3 className="weekend-part-label">{part}</h3>
              <ul className="weekend-cards">{items.map(renderCard)}</ul>
            </div>
          ))
        )}
        {overflow > 0 && (
          <button type="button" className="weekend-more" onClick={onOpenMap}>
            +{overflow} more on the map
            <ChevronRight aria-hidden="true" />
          </button>
        )}
      </section>
    );
  }

  return (
    <main className="weekend-home" aria-label="This weekend">
      <header className="weekend-hero">
        <p className="weekend-eyebrow">
          <CalendarDays aria-hidden="true" /> This weekend in {metro.label} ·{" "}
          {rangeLabel}
        </p>
        <h1>Your weekend, sorted.</h1>
        <p className="weekend-sub">
          {total > 0 ? (
            <>
              {total} {APP_AUDIENCE === "adults" ? "" : "kid-friendly "}
              {total === 1 ? "thing" : "things"} to do
              {freeCount > 0 ? ` · ${freeCount} free` : ""} — every one
              checked against the organizer&rsquo;s own calendar.
            </>
          ) : (
            <>Here&rsquo;s how this weekend is shaping up.</>
          )}
        </p>
        {SHOW_AGE_BAND_UI && (
          <div
            className="weekend-ages"
            role="group"
            aria-label="Show events for your kids' ages"
          >
            <span className="weekend-ages-label">
              {ageBand === "any" ? "Kids' ages?" : "Ages"}
            </span>
            <div className="segmented compact">
              {AGE_CHIPS.map(([band, label]) => (
                <button
                  key={band}
                  type="button"
                  className={ageBand === band ? "active" : ""}
                  onClick={() => onAgeBand(ageBand === band ? "any" : band)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        )}
      </header>

      {total === 0 ? (
        <section className="weekend-empty">
          <h2>
            Nothing dated{ageLabel ? ` for ages ${ageLabel}` : ""} this
            weekend yet
          </h2>
          <p>
            Recurring storytimes and drop-in spots don&rsquo;t always carry a
            date — the map has all of them.
          </p>
          <div className="weekend-empty-actions">
            {ageBand !== "any" && (
              <button
                type="button"
                className="secondary-button"
                onClick={() => onAgeBand("any")}
              >
                Show all ages
              </button>
            )}
            <button
              type="button"
              className="primary-button"
              onClick={onOpenMap}
            >
              <MapPin aria-hidden="true" /> Open the map
            </button>
          </div>
        </section>
      ) : (
        <div className="weekend-days">
          {renderDay(feed.sat, satScoped)}
          {renderDay(feed.sun, sunScoped)}
        </div>
      )}

      {featuredPlans.length > 0 && (
        <section className="weekend-plans" aria-label="Ready-made day plans">
          <h3>
            <Sparkles aria-hidden="true" /> Or take a ready-made day
          </h3>
          <ul className="weekend-plans-list">
            {featuredPlans.slice(0, 4).map((plan) => (
              <li key={plan.id}>
                <button
                  type="button"
                  className="weekend-plan-card"
                  onClick={() => onUsePlan(plan)}
                >
                  <strong>{plan.name}</strong>
                  <span>{plan.summary}</span>
                  <em>
                    {plan.stopIds.length} stop
                    {plan.stopIds.length === 1 ? "" : "s"} · use this plan
                  </em>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {newsletterSlot}

      <div className="weekend-exits">
        <button type="button" className="secondary-button" onClick={onOpenMap}>
          <MapPin aria-hidden="true" /> See everything on the map
        </button>
        <a className="secondary-button" href={guideHref}>
          City-by-city guide <ChevronRight aria-hidden="true" />
        </a>
      </div>
    </main>
  );
}
