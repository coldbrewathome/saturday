// Wrapped-style plan card. Rendered in three contexts:
//  1. Share preview modal (App renders <PlanCardArt> in a modal)
//  2. Public page at #/card/<id> — the backlink target for shares; injects
//     OG/twitter meta so the URL unfurls richly (mirrors EventDetailView)
//  3. Hidden export DOM — html-to-image captures <PlanCardArt> to a PNG that
//     rides the native share sheet

import { useEffect, useState } from "react";
import { ExternalLink, Loader2, Share2 } from "lucide-react";
import { getPlanCard, type PlanCardRecord } from "./planCardApi";
import { APP_BRAND, APP_DOMAIN } from "./appConfig";
import { METROS } from "./metros";

const OG_META: Array<readonly [string, "property" | "name"]> = [
  ['meta[property="og:title"]', "property"],
  ['meta[property="og:description"]', "property"],
  ['meta[property="og:url"]', "property"],
  ['meta[property="og:image"]', "property"],
  ['meta[name="twitter:title"]', "name"],
  ['meta[name="twitter:description"]', "name"],
  ['meta[name="twitter:image"]', "name"],
];

export function metroLabelForId(metroId: string): string {
  return METROS.find((m) => m.id === metroId)?.label ?? metroId;
}

// The card art itself — a fixed 1080px-wide vertical composition so the
// html-to-image export renders at a predictable size.
export function PlanCardArt({ card }: { card: Pick<PlanCardRecord, "title" | "metroId" | "stops"> }) {
  return (
    <div className="plan-card-art" data-plan-card>
      <header className="plan-card-hero">
        <span className="plan-card-eyebrow">
          {metroLabelForId(card.metroId)} · weekend plan
        </span>
        <h1 className="plan-card-title">{card.title}</h1>
      </header>
      <ul className="plan-card-stops">
        {card.stops.map((stop, index) => (
          <li key={stop.id} className="plan-card-stop">
            {stop.imageUrl ? (
              <img
                className="plan-card-stop-img"
                src={stop.imageUrl}
                alt=""
                loading="lazy"
              />
            ) : (
              <div className="plan-card-stop-fallback" aria-hidden="true" />
            )}
            <div className="plan-card-stop-overlay">
              <span className="plan-card-stop-index" aria-hidden="true">
                {index + 1}
              </span>
              <strong className="plan-card-stop-name">{stop.name}</strong>
              <span className="plan-card-stop-meta">
                {[stop.neighborhood, stop.category].filter(Boolean).join(" · ")}
                {stop.cost ? ` · ${stop.cost}` : ""}
              </span>
            </div>
          </li>
        ))}
      </ul>
      <footer className="plan-card-footer">
        <span className="plan-card-brand">{APP_BRAND}</span>
        <span className="plan-card-cta">
          Plan your weekend at {APP_DOMAIN}
        </span>
      </footer>
    </div>
  );
}

function setMeta(selector: string, kind: "property" | "name", content: string): string | null {
  const el = document.head.querySelector<HTMLMetaElement>(selector);
  const prev = el?.getAttribute("content") ?? null;
  if (el) {
    el.setAttribute("content", content);
  } else {
    const meta = document.createElement("meta");
    meta.setAttribute(kind, selector.split("=")[1].replace(/[^\w.:-]/g, ""));
    meta.setAttribute("content", content);
    document.head.appendChild(meta);
  }
  return prev;
}

export default function PlanCardView({ cardId }: { cardId: string }) {
  const [card, setCard] = useState<PlanCardRecord | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setCard(null);
    setError(false);
    getPlanCard(cardId)
      .then((c) => {
        if (cancelled) return;
        setCard(c);
      })
      .catch(() => {
        if (cancelled) return;
        setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [cardId]);

  // OG/twitter meta so the shared #/card/<id> URL unfurls (Slack, iMessage,
  // Twitter) with the plan title + first stop photo.
  useEffect(() => {
    if (!card) return;
    const title = `${card.title} — ${metroLabelForId(card.metroId)} | ${APP_BRAND}`;
    const description = card.stops.map((s) => s.name).join(", ");
    const heroImage = card.stops[0]?.imageUrl;
    const canonicalUrl = `${window.location.origin}${window.location.pathname}#/card/${card.cardId}`;

    const prevTitle = document.title;
    document.title = title;
    const contents: Record<string, string | null> = {
      'meta[property="og:title"]': title,
      'meta[property="og:description"]': description,
      'meta[property="og:url"]': canonicalUrl,
      'meta[property="og:image"]': heroImage ?? null,
      'meta[name="twitter:title"]': title,
      'meta[name="twitter:description"]': description,
      'meta[name="twitter:image"]': heroImage ?? null,
    };
    const prevs = OG_META.map(([selector, kind]) => {
      const content = contents[selector];
      if (content == null) return null;
      return setMeta(selector, kind, content);
    });

    return () => {
      document.title = prevTitle;
      OG_META.forEach(([selector], index) => {
        const el = document.head.querySelector<HTMLMetaElement>(selector);
        if (!el) return;
        const prev = prevs[index];
        if (prev === null) el.removeAttribute("content");
        else el.setAttribute("content", prev);
      });
    };
  }, [card]);

  if (error) {
    return (
      <main className="plan-card-page">
        <div className="plan-card-empty">
          <h1>This plan card has expired</h1>
          <p>
            Plan cards live for 90 days. Head back to {APP_DOMAIN} to plan a
            new weekend.
          </p>
          <a className="primary-button" href={`${window.location.origin}${window.location.pathname}`}>
            Back to {APP_BRAND}
          </a>
        </div>
      </main>
    );
  }

  if (!card) {
    return (
      <main className="plan-card-page">
        <div className="plan-card-empty">
          <Loader2 className="spin" aria-hidden="true" />
          <p>Loading plan…</p>
        </div>
      </main>
    );
  }

  return (
    <main className="plan-card-page">
      <PlanCardArt card={card} />
      <div className="plan-card-actions">
        <a
          className="primary-button"
          href={`${window.location.origin}${window.location.pathname}`}
        >
          Plan your weekend at {APP_DOMAIN} <ExternalLink size={14} aria-hidden="true" />
        </a>
        <button
          type="button"
          className="secondary-button"
          onClick={() => {
            navigator.clipboard?.writeText(window.location.href).catch(() => {});
          }}
        >
          <Share2 size={14} aria-hidden="true" /> Copy link
        </button>
      </div>
    </main>
  );
}
