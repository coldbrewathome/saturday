// "Hop me now" modal — right-now picks from spots + upcoming events, using
// the shared hopNow scorer. Extracted from App.tsx (2026-08); App re-exports
// HopNowPanel for compatibility.
import { useEffect, useMemo, useState } from "react";
import { X } from "lucide-react";
import {
  hopNowPicks,
  type HopNowEvent,
  type HopNowPick,
  type HopNowResult,
  type HopNowSpot,
} from "./hopNow";
import { isUpcomingEvent } from "./eventFreshness";
import type { FamilyEvent, PlanItemRef, Spot } from "./types";
import type { MetroConfig } from "./metros";

export function resolveHopNowLocation(
  saved: { lat: number; lon: number } | null,
  inferred: { lat: number | null; lon: number | null } | null,
  metro: MetroConfig,
): { lat: number; lon: number } | null {
  if (saved) return saved;
  if (inferred?.lat == null || inferred?.lon == null) return null;
  const bbox = metro.spotCoverage?.bbox;
  if (!bbox) return { lat: inferred.lat, lon: inferred.lon };
  const inMetro =
    inferred.lat >= bbox.south &&
    inferred.lat <= bbox.north &&
    inferred.lon >= bbox.west &&
    inferred.lon <= bbox.east;
  return inMetro ? { lat: inferred.lat, lon: inferred.lon } : null;
}

function spotToHopNow(spot: Spot): HopNowSpot {
  return {
    id: spot.id,
    name: spot.name,
    neighborhood: spot.neighborhood,
    category: spot.category,
    lat: spot.lat,
    lon: spot.lon,
    transitMinutes: spot.transitMinutes,
    schedule: spot.schedule ?? null,
    cost: spot.cost,
    kidsFriendly: spot.kidsFriendly ?? null,
    audiences: spot.audiences,
    friendScore: spot.friendScore,
    googleRating: spot.googleRating,
    googleRatingCount: spot.googleRatingCount,
    tags: spot.tags,
    mood: spot.mood,
    website: spot.website ?? null,
    sourceUrl: spot.sourceUrl,
  };
}

function eventToHopNow(event: FamilyEvent): HopNowEvent | null {
  if (!event.startDateTime) return null;
  return {
    id: event.id,
    title: event.title,
    venue: event.venue,
    neighborhood: event.neighborhood,
    category: event.category,
    lat: event.lat,
    lon: event.lon,
    startDateTime: event.startDateTime,
    endDateTime: event.endDateTime ?? null,
    cost: event.cost,
    url: event.url,
  };
}

function mapsHref(query: string): string {
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

export function HopNowPanel({
  spots,
  events,
  userLocation,
  audience,
  activePlanName,
  onAddToPlan,
  onClose,
  metroTimeZone,
}: {
  spots: Spot[];
  events: FamilyEvent[];
  userLocation: { lat: number; lon: number } | null;
  audience: "kids" | "adults";
  activePlanName: string | null;
  onAddToPlan: (item: PlanItemRef) => void;
  onClose: () => void;
  metroTimeZone?: string;
}) {
  const [seed, setSeed] = useState(0);
  const [excludeIds, setExcludeIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  const [addedIds, setAddedIds] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
  // B1.7: a Hop Now panel left open (or backgrounded and returned to) should
  // not keep suggesting an event that has since ended.
  const [clockTick, setClockTick] = useState(0);
  useEffect(() => {
    const tick = () => setClockTick((n) => n + 1);
    const interval = setInterval(tick, 5 * 60 * 1000);
    const onVisibility = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  const result: HopNowResult = useMemo(() => {
    const now = new Date();
    const hopSpots = spots.map(spotToHopNow);
    // Freshness gate: hopNowPicks re-checks timing, but never hand it an
    // event that already ended.
    const hopEvents = events
      .filter((event) => isUpcomingEvent(event, now, { timeZone: metroTimeZone }))
      .map(eventToHopNow)
      .filter((e): e is HopNowEvent => e !== null);
    return hopNowPicks(hopSpots, hopEvents, {
      now,
      audience,
      userLocation,
      shuffleSeed: seed,
      excludeIds,
    });
  }, [audience, events, seed, spots, userLocation, excludeIds, metroTimeZone, clockTick]);

  function tryNewBatch() {
    // Park the IDs we just showed so the next batch surfaces fresh items.
    const shown = new Set(excludeIds);
    for (const pick of result.picks) shown.add(pick.id);
    setExcludeIds(shown);
    setSeed((s) => s + 1);
  }

  function resetBatch() {
    setExcludeIds(new Set());
    setSeed((s) => s + 1);
  }

  function handleAdd(pick: HopNowPick) {
    onAddToPlan({ kind: pick.kind, id: pick.id });
    setAddedIds((current) => {
      const next = new Set(current);
      next.add(pick.id);
      return next;
    });
  }

  const exhausted = excludeIds.size > 0 && result.picks.length === 0;

  return (
    <div className="hop-now-backdrop" role="presentation" onClick={onClose}>
      <div
        className="hop-now-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Hop me now"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="hop-now-head">
          <div>
            <p className="eyebrow">Right now</p>
            <h2>Hop me now</h2>
            <p className="hop-now-sub">
              Open, nearby, and good for the next hour or two.
            </p>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label="Close"
          >
            <X aria-hidden="true" />
          </button>
        </div>

        {result.reason && !exhausted && (
          <p className="hop-now-reason">{result.reason}</p>
        )}
        {exhausted && (
          <p className="hop-now-reason">
            That's everything nearby right now. Reset to start over.
          </p>
        )}

        {result.picks.length > 0 && (
          <ul className="hop-now-list">
            {result.picks.map((pick) => (
              <HopNowCard
                key={`${pick.kind}:${pick.id}`}
                pick={pick}
                added={addedIds.has(pick.id)}
                activePlanName={activePlanName}
                onAdd={() => handleAdd(pick)}
              />
            ))}
          </ul>
        )}

        <div className="hop-now-foot">
          {exhausted ? (
            <button
              type="button"
              className="text-button"
              onClick={resetBatch}
            >
              Reset
            </button>
          ) : (
            <button
              type="button"
              className="text-button"
              onClick={tryNewBatch}
              disabled={result.picks.length === 0}
            >
              Try a new batch
            </button>
          )}
          {!userLocation && (
            <span className="hop-now-hint">
              Tip: allow location for better picks.
            </span>
          )}
        </div>
      </div>
    </div>
  );
}

function HopNowCard({
  pick,
  added,
  activePlanName,
  onAdd,
}: {
  pick: HopNowPick;
  added: boolean;
  activePlanName: string | null;
  onAdd: () => void;
}) {
  const meta: string[] = [];
  if (pick.etaMinutes != null) {
    meta.push(`${pick.etaMinutes} min away`);
  }
  if (pick.kind === "spot") {
    if (pick.alwaysOpen) meta.push("Open 24/7");
    else if (pick.closesAtMinutes != null) {
      const m = ((pick.closesAtMinutes % 1440) + 1440) % 1440;
      const h24 = Math.floor(m / 60);
      const mm = m % 60;
      const ampm = h24 >= 12 ? "PM" : "AM";
      const h12 = ((h24 + 11) % 12) + 1;
      const label = mm === 0 ? `${h12}${ampm}` : `${h12}:${mm.toString().padStart(2, "0")}${ampm}`;
      meta.push(`Until ${label}`);
    }
  } else if (pick.kind === "event") {
    if (pick.startsInMinutes <= 0) meta.push("In progress");
    else meta.push(`Starts in ${pick.startsInMinutes} min`);
  }
  return (
    <li className="hop-now-card">
      <div className="hop-now-card-head">
        <span className="hop-now-card-cat">{pick.category}</span>
        {pick.kind === "event" && <span className="hop-now-card-badge">Event</span>}
      </div>
      <h3>{pick.name}</h3>
      <p className="hop-now-card-where">
        {pick.kind === "event" ? `${pick.venue} · ${pick.neighborhood}` : pick.neighborhood}
      </p>
      <p className="hop-now-card-why">{pick.whyNow}</p>
      {meta.length > 0 && (
        <p className="hop-now-card-meta">{meta.join(" · ")}</p>
      )}
      <div className="hop-now-card-actions">
        <a
          className="primary-button"
          href={mapsHref(pick.mapsQuery)}
          target="_blank"
          rel="noopener noreferrer"
        >
          Take me there
        </a>
        <button
          type="button"
          className="text-button hop-now-add"
          onClick={onAdd}
          disabled={added}
          title={
            added
              ? "Added"
              : activePlanName
                ? `Add to "${activePlanName}"`
                : "Save to a new plan"
          }
        >
          {added ? "Added ✓" : activePlanName ? "Add to plan" : "Save to plan"}
        </button>
        {pick.kind === "event" && pick.url && (
          <a
            className="text-button"
            href={pick.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Event details
          </a>
        )}
        {pick.kind === "spot" && pick.url && (
          <a
            className="text-button"
            href={pick.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Website
          </a>
        )}
      </div>
    </li>
  );
}
