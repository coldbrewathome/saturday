// Card art shared by the share-preview modal (App) and the standalone
// #/card/<id> page (PlanCardView). Lives in its own module so the lazy
// PlanCardView route doesn't drag its page chrome into the app boot chunk.

import { APP_BRAND, APP_DOMAIN } from "./appConfig";
import { METROS } from "./metros";
import type { PlanCardRecord } from "./planCardApi";

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
