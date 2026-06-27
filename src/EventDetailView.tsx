// Plain in-app detail view for an event, reachable at `#/event/<slug>`.
// Per ADR-04: the SPA hash route is a sibling of the prerendered
// `/<metro>/events/<slug>/` static page — they don't redirect to each other.
//
// JSON-LD `Event` + OG/twitter meta are mirrored client-side so that the
// in-app URL (the one shared from within the SPA) also unfurls richly.
// The prerendered static page (scripts/generate-seo-pages.mjs ::
// generateEventPages / buildEventJsonLd) remains the canonical surface for
// crawlers; this effect is the cosmetic + JS-aware-share-bot fallback.

import { useEffect } from "react";
import { Check, ChevronLeft, Plus, Share2 } from "lucide-react";
import type { FamilyEvent } from "./App";
import type { MetroConfig } from "./metros";
import { APP_BRAND } from "./appConfig";

type Props = {
  events: FamilyEvent[];
  slug: string | null;
  metro: MetroConfig;
  onBack: () => void;
  /** Name of the active plan, or null when none is active. */
  activePlanName: string | null;
  /** Event ids already in the active plan (for the "in plan" state). */
  planEventIds: string[];
  /** Add this event to the active plan, or seed a new plan with it. */
  onAddToPlan: (eventId: string) => void;
  /** One-tap share (native share sheet / clipboard) for this event. */
  onShare: (title: string, slug: string) => void;
  /** URL most recently copied, so the button can flash "Copied!". */
  shareCopiedUrl: string | null;
  /** Builds the share URL for a slug (to match against shareCopiedUrl). */
  shareUrlFor: (slug: string) => string;
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

function formatEventDate(value?: string | null): string {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

function buildDescription(event: FamilyEvent): string {
  const dateStr = formatEventDate(event.startDateTime);
  const where = event.venue || event.city || "";
  const when = dateStr ? ` on ${dateStr}` : "";
  const cat = event.category ? ` (${event.category})` : "";
  const cost = event.cost && event.cost !== "Unknown" ? ` Cost: ${event.cost}.` : "";
  const ages = Array.isArray(event.ageBands) && event.ageBands.length
    ? ` Best for: ${event.ageBands.join(", ")}.`
    : "";
  const desc = (event.description || "").replace(/\s+/g, " ").trim();
  const trimmed = desc.length > 160 ? `${desc.slice(0, 160)}…` : desc;
  return `${event.title}${when}${where ? ` at ${where}` : ""}${cat}.${cost}${ages} ${trimmed}`
    .trim()
    .slice(0, 300);
}

function buildEventJsonLd(
  event: FamilyEvent,
  metro: MetroConfig,
  canonicalUrl: string,
): Record<string, unknown> {
  const node: Record<string, unknown> = {
    "@context": "https://schema.org",
    "@type": "Event",
    "@id": `${canonicalUrl}#event`,
    name: event.title,
    url: canonicalUrl,
    description: buildDescription(event),
    eventAttendanceMode: "https://schema.org/OfflineEventAttendanceMode",
    eventStatus: "https://schema.org/EventScheduled",
  };
  if (event.startDateTime) node.startDate = event.startDateTime;
  if (event.endDateTime) node.endDate = event.endDateTime;
  const venue = event.venue || event.city;
  if (venue) {
    const location: Record<string, unknown> = {
      "@type": "Place",
      name: venue,
      address: {
        "@type": "PostalAddress",
        addressLocality: event.city || metro.label,
        addressCountry: "US",
      },
    };
    if (typeof event.lat === "number" && typeof event.lon === "number") {
      location.geo = {
        "@type": "GeoCoordinates",
        latitude: event.lat,
        longitude: event.lon,
      };
    }
    node.location = location;
  }
  if (event.sourceName) {
    node.organizer = {
      "@type": "Organization",
      name: event.sourceName,
      url: event.url || canonicalUrl,
    };
  }
  if (event.url) {
    const costStr = String(event.cost || "");
    const isFree = /free|gratis/i.test(costStr) || costStr === "$0";
    let price: string | null = null;
    if (isFree) {
      price = "0";
      node.isAccessibleForFree = true;
    } else {
      const m = costStr.match(/([0-9]+(?:\.[0-9]{2})?)/);
      if (m) price = m[1];
    }
    if (price !== null) {
      node.offers = {
        "@type": "Offer",
        url: event.url,
        price,
        priceCurrency: "USD",
        availability: "https://schema.org/InStock",
      };
    }
  }
  if (Array.isArray(event.ageBands) && event.ageBands.length) {
    node.audience = {
      "@type": "PeopleAudience",
      audienceType: event.ageBands.join(", "),
    };
  }
  return node;
}

function setMeta(selector: string, content: string): string | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const prev = el.getAttribute("content");
  el.setAttribute("content", content);
  return prev;
}

function setLink(selector: string, href: string): string | null {
  const el = document.querySelector(selector);
  if (!el) return null;
  const prev = el.getAttribute("href");
  el.setAttribute("href", href);
  return prev;
}

function restoreMeta(selector: string, prev: string | null) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (prev === null) el.removeAttribute("content");
  else el.setAttribute("content", prev);
}

function restoreLink(selector: string, prev: string | null) {
  const el = document.querySelector(selector);
  if (!el) return;
  if (prev === null) el.removeAttribute("href");
  else el.setAttribute("href", prev);
}

export default function EventDetailView({
  events,
  slug,
  metro,
  onBack,
  activePlanName,
  planEventIds,
  onAddToPlan,
  onShare,
  shareCopiedUrl,
  shareUrlFor,
}: Props) {
  const event = slug ? events.find((e) => e.slug === slug) : null;
  const inPlan = event ? planEventIds.includes(event.id) : false;
  const shareCopied = Boolean(
    event?.slug && shareCopiedUrl === shareUrlFor(event.slug),
  );

  useEffect(() => {
    if (!slug) return;

    if (!event) {
      const robots = document.createElement("meta");
      robots.name = "robots";
      robots.content = "noindex,follow";
      document.head.appendChild(robots);

      const prevTitle = document.title;
      document.title = `Event Ended | ${APP_BRAND}`;

      return () => {
        document.title = prevTitle;
        robots.remove();
      };
    }

    const canonicalUrl = `${window.location.origin}${metro.canonicalPath.replace(/\/+$/, "")}/event/${encodeURIComponent(slug)}/`;
    const title = `${event.title} — ${event.city || metro.label} | ${APP_BRAND}`;
    const description = buildDescription(event);

    const prevTitle = document.title;
    document.title = title;

    const prevDescription = setMeta('meta[name="description"]', description);
    const prevOgTitle = setMeta('meta[property="og:title"]', title);
    const prevOgDescription = setMeta('meta[property="og:description"]', description);
    const prevOgUrl = setMeta('meta[property="og:url"]', canonicalUrl);
    const prevTwitterTitle = setMeta('meta[name="twitter:title"]', title);
    const prevTwitterDescription = setMeta('meta[name="twitter:description"]', description);
    const prevCanonical = setLink('link[rel="canonical"]', canonicalUrl);

    const jsonLd = buildEventJsonLd(event, metro, canonicalUrl);
    const script = document.createElement("script");
    script.type = "application/ld+json";
    script.setAttribute("data-event-detail", "1");
    script.text = JSON.stringify(jsonLd);
    document.head.appendChild(script);

    return () => {
      document.title = prevTitle;
      restoreMeta('meta[name="description"]', prevDescription);
      restoreMeta('meta[property="og:title"]', prevOgTitle);
      restoreMeta('meta[property="og:description"]', prevOgDescription);
      restoreMeta('meta[property="og:url"]', prevOgUrl);
      restoreMeta('meta[name="twitter:title"]', prevTwitterTitle);
      restoreMeta('meta[name="twitter:description"]', prevTwitterDescription);
      restoreLink('link[rel="canonical"]', prevCanonical);
      script.remove();
    };
  }, [event, slug, metro]);

  return (
    <main className="event-detail-view" aria-label="Event details">
      <button type="button" className="text-button" onClick={onBack}>
        <ChevronLeft aria-hidden="true" />
        Back
      </button>

      {!event ? (
        <section className="event-detail-empty">
          <h1>This event has ended</h1>
          <p>
            This one's no longer in the current {metro.label} listings — it has
            likely already happened. Here's what's coming up instead.
          </p>
          <p className="event-detail-empty-actions">
            <a
              className="primary-button"
              href={`${metro.canonicalPath.replace(/\/+$/, "")}/this-weekend/`}
            >
              See what's on this weekend in {metro.label}
            </a>
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

          <div className="event-detail-actions">
            <button
              type="button"
              className={`event-detail-plan-cta${inPlan ? " is-added" : ""}`}
              onClick={() => onAddToPlan(event.id)}
            >
              {inPlan ? (
                <>
                  <Check aria-hidden="true" /> In your plan — view
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" />{" "}
                  {activePlanName
                    ? `Add to "${activePlanName}"`
                    : "Add to a plan"}
                </>
              )}
            </button>
            {event.slug && (
              <button
                type="button"
                className="event-detail-share-cta"
                onClick={() => onShare(event.title, event.slug!)}
              >
                <Share2 aria-hidden="true" /> {shareCopied ? "Copied!" : "Share"}
              </button>
            )}
          </div>

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
