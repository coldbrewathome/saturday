// Plain in-app detail view for an event, reachable at `#/event/<slug>`.
// Per ADR-04: the SPA hash route is a sibling of the prerendered
// `/<metro>/events/<slug>/` static page — they don't redirect to each other.
//
// v1 scope (matches the roadmap task): take metro + slug, find the event in
// the events array already loaded by App, render title/date/venue/description.
// Plain layout. Visual polish, JSON-LD/OG, and "View details" entry points
// are tracked as separate roadmap tasks.

import { ChevronLeft } from "lucide-react";
import type { FamilyEvent } from "./App";
import type { MetroConfig } from "./metros";

type Props = {
  events: FamilyEvent[];
  slug: string | null;
  metro: MetroConfig;
  onBack: () => void;
};

function formatStart(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export default function EventDetailView({ events, slug, metro, onBack }: Props) {
  const event = slug ? events.find((e) => e.slug === slug) : null;

  return (
    <main className="event-detail-view" aria-label="Event details">
      <button type="button" className="text-button" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
        Back
      </button>

      {!event ? (
        <section className="event-detail-empty">
          <h1>Event not found</h1>
          <p>
            We couldn't find this event in the current {metro.label} listings.
            It may have ended or been re-slugged in a recent refresh.
          </p>
        </section>
      ) : (
        <article className="event-detail">
          <header>
            <h1>{event.title}</h1>
            {formatStart(event.startDateTime) && (
              <p className="event-detail-when">{formatStart(event.startDateTime)}</p>
            )}
            <p className="event-detail-where">
              {event.venue}
              {event.city ? ` · ${event.city}` : ""}
            </p>
          </header>

          {event.description && (
            <p className="event-detail-description">{event.description}</p>
          )}

          {event.url && (
            <p className="event-detail-source">
              <a href={event.url} target="_blank" rel="noopener noreferrer">
                View original listing
              </a>
            </p>
          )}
        </article>
      )}
    </main>
  );
}
