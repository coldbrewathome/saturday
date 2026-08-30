// Decision-first weekend home — the "Weekend" tab and the kids-brand default
// landing view. The browse map answers "what's everywhere"; this view answers
// the question a parent actually arrives with: "what are we doing Saturday?"
//
// The entrance is a *briefing*, not an inventory:
//   1. hero — dates + weather for Sat/Sun + age band, so the weekend is
//      concrete in one glance;
//   2. headliner — the single best thing this weekend, one tap from a plan;
//   3. best-of — a short ranked list (popular picks, editor's picks, then
//      family-fit + notability), chips explain every rank;
//   4. Sat/Sun timeline — Morning/Afternoon/Evening, the nap-schedule units
//      families actually plan in;
//   5. a share-the-weekend hook — the build→share loop is the funnel gap;
//   6. ready-made days — curated photo plans, zero planning required.

import { useMemo } from "react";
import type { ReactNode } from "react";
import {
  Bookmark,
  CalendarDays,
  Check,
  ChevronRight,
  Cloud,
  CloudDrizzle,
  CloudFog,
  CloudLightning,
  CloudRain,
  CloudSun,
  Flame,
  MapPin,
  Plus,
  Share2,
  SlidersHorizontal,
  Snowflake,
  Sparkles,
  Sun,
  ThumbsUp,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { FamilyEvent, FeaturedPlan } from "./App";
import type { MetroConfig } from "./metros";
import type { AgeBand } from "./planner";
import { APP_AUDIENCE, SHOW_AGE_BAND_UI } from "./appConfig";
import type { WeatherForecast } from "./api";
import { isUpcomingEvent } from "./eventFreshness";
import { resolvePopularEvents, type PopularEventsDataset } from "./popularEvents";
import { importanceScore, selectNewEvents } from "./newEvents";
import { isFeedJunkEvent } from "./eventQuality";
import {
  EMPTY_VENUE_MAP,
  eventImageSmall,
  venueImageFor,
  type VenueImageMap,
} from "./eventImages";
import { scoreEventForFamily, type FamilyProfile } from "./familyProfile";
import { trustBoost, type EventTrust } from "./checkinApi";
import { sourceHostname } from "./appUtils";
import {
  buildBestOf,
  pickHeadliner,
  rankWeekendEvents,
  weatherBrief,
  type WeatherIconKind,
} from "./weekendBrief";

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

// The headliner is the #1 ranked event; best-of shows ranks 2..cap+1 so the
// same card never appears twice on the page.
const BEST_OF_CAP = 6;

const WEATHER_ICONS: Record<WeatherIconKind, LucideIcon> = {
  sun: Sun,
  "cloud-sun": CloudSun,
  cloud: Cloud,
  fog: CloudFog,
  drizzle: CloudDrizzle,
  rain: CloudRain,
  snow: Snowflake,
  storm: CloudLightning,
};

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

// Anticipation hook for the eyebrow: Mon–Thu "in N days", Fri "starts
// tomorrow", Sat "it's today", Sun nothing (the feed shows today+yesterday).
function countdownLabel(now: Date): string | null {
  const dow = now.getDay();
  if (dow === 6) return "it's today";
  if (dow === 5) return "starts tomorrow";
  if (dow >= 1 && dow <= 4) {
    const days = 6 - dow;
    return days === 1 ? "starts tomorrow" : `in ${days} days`;
  }
  return null;
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

function weekendDayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: "long" });
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
  /** First-run family profile; when present the feed is re-ranked for it. */
  profile?: FamilyProfile | null;
  /** Device/IP-derived home coords for proximity ranking (best effort). */
  homeLocation?: { lat: number; lon: number } | null;
  /** Re-open the profile wizard ("Edit profile"). */
  onEditProfile?: () => void;
  /** Aggregate check-in trust per event id (badges + ranking boost). */
  trust?: ReadonlyMap<string, EventTrust>;
  /** Venue → curated photo index; events without their own photo use the
   * venue's real image instead of a blank card. */
  venueImages?: VenueImageMap;
  /** Editorial "Popular this weekend" picks; stale/empty → section hidden. */
  popularPicks?: PopularEventsDataset | null;
  /** "New since your last visit" baseline (ISO); null/absent → section hidden. */
  lastVisit?: string | null;
  /** Weekend forecast (Sat/Sun) — powers the weather pills + planning hint. */
  weather?: WeatherForecast | null;
  /** One-tap share of the whole weekend briefing (funnel share hook). */
  onShareWeekend?: (title: string, url: string) => void;
  /** URL the "Share the weekend" hook sends. */
  shareUrl?: string;
  /** Spot id → photo for ready-made day-plan cover images. */
  stopImages?: Record<string, string>;
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
  profile,
  homeLocation,
  onEditProfile,
  trust,
  venueImages,
  popularPicks,
  lastVisit,
  weather,
  onShareWeekend,
  shareUrl,
  stopImages,
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
          isUpcomingEvent(e, now, { timeZone: metro.timezone }) &&
          !isFeedJunkEvent(e),
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

  // Event ids referenced by any curated featured plan — rendered as an honest
  // "Editor's pick" tag (a human-curated signal, not a rating).
  const editorPickedEventIds = useMemo(() => {
    const ids = new Set<string>();
    for (const plan of featuredPlans) {
      for (const id of plan.eventIds ?? []) ids.add(id);
    }
    return ids;
  }, [featuredPlans]);

  // Editorial "Popular this weekend" picks. Resolved against the live feed so
  // unknown/stale/ended picks drop out — the section only shows events that
  // are genuinely in this weekend's window.
  const popularEvents = useMemo(
    () =>
      resolvePopularEvents({
        dataset: popularPicks,
        events,
        sat: feed.sat,
        sun: feed.sun,
        timeZone: metro.timezone,
      }),
    [popularPicks, events, feed, metro],
  );
  const popularEventIds = useMemo(
    () => new Set(popularEvents.map((event) => event.id)),
    [popularEvents],
  );

  const scope = (list: FamilyEvent[]) =>
    ageBand === "any" ? list : list.filter((e) => e.ageBands.includes(ageBand));
  const home = homeLocation ?? null;
  // Personalization: when a family profile exists, re-rank each day so the
  // best-fit events lead their daypart (stable sort keeps time order within
  // ties, so an unprofiled feed stays purely chronological). Trusted events
  // (check-in aggregates) get a small boost on top.
  const familyScore = (event: FamilyEvent) =>
    scoreEventForFamily(event, { profile: profile ?? null, home }) +
    trustBoost(trust?.get(event.id)?.trustScore ?? null);
  const rank = (list: FamilyEvent[]) =>
    profile || (trust && trust.size > 0)
      ? [...list].sort(
          (a, b) => familyScore(b) - familyScore(a),
        )
      : list;
  const satScoped = rank(scope(feed.satEvents));
  const sunScoped = rank(scope(feed.sunEvents));
  const popularScoped = scope(popularEvents);
  // "New since your last visit" — events first seen at ingest after the
  // visitor's previous page load, ranked by importance + popularity. First
  // visit (null baseline) degrades to an empty list → no NEW chips.
  const newEvents = useMemo(
    () =>
      selectNewEvents(events, {
        lastVisit: lastVisit ?? null,
        sat: feed.sat,
        sun: feed.sun,
        timeZone: metro.timezone,
        popularPicks,
        featuredPlans,
        trust,
      }),
    [lastVisit, events, feed, metro, popularPicks, featuredPlans, trust],
  );
  const newEventsScoped = scope(newEvents);
  const newEventIds = useMemo(
    () => new Set(newEventsScoped.map((event) => event.id)),
    [newEventsScoped],
  );
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
  })}–${
    feed.sat.getMonth() === feed.sun.getMonth()
      ? feed.sun.getDate()
      : feed.sun.toLocaleDateString(undefined, { month: "short", day: "numeric" })
  }`;

  // ── The briefing: headliner + best-of ranking ────────────────────────
  const hasPhotoFor = (event: FamilyEvent) =>
    Boolean(
      eventImageSmall(event) ??
        venueImageFor(event, venueImages ?? EMPTY_VENUE_MAP),
    );
  // Popular picks resolve against the raw dataset (pre junk-filter/dedupe);
  // union them into the feed so a rank-1 pick can never fall out of the
  // headliner race because the feed collapsed its duplicate.
  const rankedEvents = useMemo(() => {
    const byId = new Map<string, FamilyEvent>();
    for (const event of [...satScoped, ...sunScoped, ...popularScoped]) {
      if (!byId.has(event.id)) byId.set(event.id, event);
    }
    return [...byId.values()];
  }, [satScoped, sunScoped, popularScoped]);
  const ranked = useMemo(
    () =>
      rankWeekendEvents({
        events: rankedEvents,
        popularEvents: popularScoped,
        editorEventIds: editorPickedEventIds,
        profile: profile ?? null,
        home,
        trust,
        hasPhotoFor,
        notabilityFor: importanceScore,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [rankedEvents, popularScoped, editorPickedEventIds, profile, home, trust, venueImages],
  );
  const headliner = pickHeadliner(ranked);
  const bestOf = buildBestOf(ranked.slice(1), BEST_OF_CAP);
  const brief = weatherBrief(weather);

  function renderCard(event: FamilyEvent, showNewChip = false) {
    const saved = savedEventIds.includes(event.id);
    const inPlan = planEventIds.includes(event.id);
    const host =
      event.verified && event.url ? sourceHostname(event.url) : null;
    const free = event.cost === "Free";
    const showCost = !free && event.cost && event.cost !== "Unknown";
    // Trust badge: only when enough families have checked in for the score to
    // be stable (>=3 answers) — a single "worth it" is noise, not proof.
    const eventTrust = trust?.get(event.id);
    const trustLabel =
      eventTrust && eventTrust.total >= 3 && eventTrust.trustScore != null
        ? `${eventTrust.trustScore}% of parents said worth it`
        : null;
    const editorPicked = editorPickedEventIds.has(event.id);
    // The event's own photo, else the venue's real photo (honest — it's the
    // place), else a neutral placeholder.
    const thumb =
      eventImageSmall(event) ?? venueImageFor(event, venueImages ?? EMPTY_VENUE_MAP);
    return (
      <li key={event.id} className="weekend-card">
        {thumb ? (
          <img
            className="weekend-card-img"
            src={thumb}
            alt=""
            loading="lazy"
          />
        ) : (
          // No photo exists for this event — a neutral category block, never
          // a stock stand-in.
          <span className="weekend-card-img weekend-card-img-placeholder" aria-hidden="true">
            {event.category.slice(0, 1)}
          </span>
        )}
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
          {(free || showCost || host || trustLabel || editorPicked || popularEventIds.has(event.id) || showNewChip) && (
            <span className="weekend-card-meta">
              {showNewChip && <em className="weekend-chip-new">NEW</em>}
              {editorPicked && (
                <em className="weekend-chip-editors">Editor&rsquo;s pick</em>
              )}
              {popularEventIds.has(event.id) && (
                <em className="weekend-chip-popular">
                  <Flame size={11} aria-hidden="true" />
                  Popular
                </em>
              )}
              {free && <em className="weekend-chip-free">Free</em>}
              {showCost && <em className="weekend-chip">{event.cost}</em>}
              {trustLabel && (
                <em className="trust-badge" title={trustLabel}>
                  <ThumbsUp aria-hidden="true" />
                  {eventTrust!.trustScore}%
                </em>
              )}
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

  function renderHeadliner() {
    const event = headliner!.event;
    const saved = savedEventIds.includes(event.id);
    const inPlan = planEventIds.includes(event.id);
    const host =
      event.verified && event.url ? sourceHostname(event.url) : null;
    const free = event.cost === "Free";
    const showCost = !free && event.cost && event.cost !== "Unknown";
    const eventTrust = trust?.get(event.id);
    const trustLabel =
      eventTrust && eventTrust.total >= 3 && eventTrust.trustScore != null
        ? `${eventTrust.trustScore}% of parents said worth it`
        : null;
    const editorPicked = editorPickedEventIds.has(event.id);
    const isNew = newEventIds.has(event.id);
    const dayLabel = weekendDayLabel(new Date(event.startDateTime!));
    const thumb =
      eventImageSmall(event) ?? venueImageFor(event, venueImages ?? EMPTY_VENUE_MAP);
    return (
      <section className="weekend-headliner" aria-label="The one to plan around">
        <div className="weekend-headliner-media">
          {thumb ? (
            <img className="weekend-headliner-img" src={thumb} alt="" />
          ) : (
            <span
              className="weekend-headliner-img weekend-headliner-placeholder"
              aria-hidden="true"
            >
              {event.category.slice(0, 1)}
            </span>
          )}
          <span className="weekend-headliner-day">
            {dayLabel} · {timeLabel(event)}
          </span>
        </div>
        <div className="weekend-headliner-body">
          <p className="weekend-headliner-kicker">
            <Sparkles aria-hidden="true" /> The one to plan around
          </p>
          <h2 className="weekend-headliner-title">
            {event.slug ? (
              <a href={`#/event/${encodeURIComponent(event.slug)}`}>
                {event.title}
              </a>
            ) : (
              event.title
            )}
          </h2>
          <p className="weekend-headliner-where">
            {event.venue}
            {event.city ? ` · ${event.city}` : ""}
          </p>
          {(isNew || free || showCost || host || trustLabel || editorPicked || popularEventIds.has(event.id)) && (
            <span className="weekend-card-meta">
              {isNew && <em className="weekend-chip-new">NEW</em>}
              {editorPicked && (
                <em className="weekend-chip-editors">Editor&rsquo;s pick</em>
              )}
              {popularEventIds.has(event.id) && (
                <em className="weekend-chip-popular">
                  <Flame size={11} aria-hidden="true" />
                  Popular
                </em>
              )}
              {free && <em className="weekend-chip-free">Free</em>}
              {showCost && <em className="weekend-chip">{event.cost}</em>}
              {trustLabel && (
                <em className="trust-badge" title={trustLabel}>
                  <ThumbsUp aria-hidden="true" />
                  {eventTrust!.trustScore}%
                </em>
              )}
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
          <div className="weekend-headliner-actions">
            <button
              type="button"
              className={`primary-button${inPlan ? " is-in-plan" : ""}`}
              onClick={() => {
                if (!inPlan) onAddToPlan(event.id);
              }}
            >
              {inPlan ? (
                <>
                  <Check aria-hidden="true" /> In your {dayLabel} plan
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" /> Add to {dayLabel} plan
                </>
              )}
            </button>
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
        </div>
      </section>
    );
  }

  function renderDay(date: Date, list: FamilyEvent[]) {
    const shown = list.slice(0, DAY_CAP);
    const overflow = list.length - shown.length;
    const parts = DAYPARTS.map((part) => ({
      part,
      items: shown.filter((e) => e.timeWindow === part),
    })).filter((group) => group.items.length > 0);
    const weekday = weekendDayLabel(date);
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
              <ul className="weekend-cards">{items.map((e) => renderCard(e))}</ul>
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

  const countdown = countdownLabel(new Date());

  return (
    <main className="weekend-home" aria-label="This weekend">
      <header className="weekend-hero">
        <p className="weekend-eyebrow">
          <CalendarDays aria-hidden="true" /> This weekend in {metro.label} ·{" "}
          {rangeLabel}
          {countdown ? ` · ${countdown}` : ""}
        </p>
        {brief && (brief.saturday || brief.sunday) && (
          <div
            className="weekend-weather"
            role="group"
            aria-label="Weekend weather"
          >
            {brief.saturday && (
              <span className="weather-pill">
                {(() => {
                  const Icon = WEATHER_ICONS[brief.saturday!.icon];
                  return <Icon className="weather-pill-icon" aria-hidden="true" />;
                })()}
                <span className="weather-pill-day">Sat</span>
                {brief.saturday.tempF != null && (
                  <span className="weather-pill-temp">{brief.saturday.tempF}°</span>
                )}
                {brief.saturday.precipChance != null &&
                  brief.saturday.precipChance >= 20 && (
                    <span className="weather-pill-rain">
                      ☔ {brief.saturday.precipChance}%
                    </span>
                  )}
              </span>
            )}
            {brief.sunday && (
              <span className="weather-pill">
                {(() => {
                  const Icon = WEATHER_ICONS[brief.sunday!.icon];
                  return <Icon className="weather-pill-icon" aria-hidden="true" />;
                })()}
                <span className="weather-pill-day">Sun</span>
                {brief.sunday.tempF != null && (
                  <span className="weather-pill-temp">{brief.sunday.tempF}°</span>
                )}
                {brief.sunday.precipChance != null &&
                  brief.sunday.precipChance >= 20 && (
                    <span className="weather-pill-rain">
                      ☔ {brief.sunday.precipChance}%
                    </span>
                  )}
              </span>
            )}
            {brief.hint && <p className="weather-hint">{brief.hint}</p>}
          </div>
        )}
        <h1>
          {profile ? "Your family's weekend, briefed." : "Your weekend, briefed."}
        </h1>
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
        {profile && onEditProfile && (
          <button type="button" className="weekend-edit-profile" onClick={onEditProfile}>
            <SlidersHorizontal size={13} aria-hidden="true" />
            {profile.ageBands.length > 0
              ? `Ages ${profile.ageBands
                  .map((b) => AGE_CHIPS.find(([band]) => band === b)?.[1] ?? b)
                  .join(", ")}`
              : "Ages any"}{" "}
            · edit profile
          </button>
        )}
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

      {headliner && renderHeadliner()}

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
        <>
          {bestOf.length > 0 && (
            <section
              className="weekend-bestof"
              aria-label="Best of the weekend"
            >
              <h3>
                <Flame aria-hidden="true" /> The rest of the best
              </h3>
              <ol className="weekend-cards weekend-ranked-list">
                {bestOf.map(({ event }) => renderCard(event, newEventIds.has(event.id)))}
              </ol>
            </section>
          )}
          <div className="weekend-days">
            {renderDay(feed.sat, satScoped)}
            {renderDay(feed.sun, sunScoped)}
          </div>
        </>
      )}

      {onShareWeekend && shareUrl && (
        <section className="weekend-share" aria-label="Share this weekend">
          <div className="weekend-share-copy">
            <strong>Weekend&rsquo;s looking good?</strong>
            <span>
              Send it to your group so everyone&rsquo;s on the same page.
            </span>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={() =>
              onShareWeekend(
                `This weekend in ${metro.label} (${rangeLabel})`,
                shareUrl,
              )
            }
          >
            <Share2 aria-hidden="true" /> Share the weekend
          </button>
        </section>
      )}

      {featuredPlans.length > 0 && (
        <section className="weekend-plans" aria-label="Ready-made day plans">
          <h3>
            <Sparkles aria-hidden="true" /> No time to plan? Take a ready-made
            day
          </h3>
          <ul className="weekend-plans-list">
            {featuredPlans.slice(0, 4).map((plan) => {
              const cover = (plan.stopIds ?? [])
                .map((id) => stopImages?.[id])
                .find(Boolean);
              return (
                <li key={plan.id}>
                  <button
                    type="button"
                    className="weekend-plan-card"
                    onClick={() => onUsePlan(plan)}
                  >
                    {cover ? (
                      <img
                        className="weekend-plan-media"
                        src={cover}
                        alt=""
                        loading="lazy"
                      />
                    ) : (
                      <span
                        className="weekend-plan-media weekend-plan-media-fallback"
                        aria-hidden="true"
                      >
                        <Sparkles />
                      </span>
                    )}
                    <span className="weekend-plan-body">
                      <strong>{plan.name}</strong>
                      <span>{plan.summary}</span>
                      <em>
                        {plan.stopIds.length} stop
                        {plan.stopIds.length === 1 ? "" : "s"} · use this plan
                      </em>
                    </span>
                  </button>
                </li>
              );
            })}
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
