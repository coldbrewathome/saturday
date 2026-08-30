// Friday-digest signup. Mounted on the Plans tab, inside the browse hero
// (collapsed one-liner via collapsedLabel), the visit-3 digest modal (bare),
// and the poll page after a vote (heading override). Success is explicit and
// persists for the session — the card never silently unmounts on subscribe.
// Exported so PollView (rendered standalone by main.tsx) can reuse it.
// Extracted from App.tsx (2026-08); App re-exports for compatibility.
import { useState } from "react";
import { Check, Mail, X } from "lucide-react";
import { APP_AUDIENCE, SHOW_AGE_BAND_UI } from "./appConfig";
import { readStoredAgeBand } from "./appStorage";
import { EMAIL_RE } from "./appUtils";
import { subscribeNewsletter, trackMetric } from "./api";
import type { FamilyProfile } from "./familyProfile";

export function NewsletterCard({
  metroId,
  metroLabel,
  source = "app-plans",
  heading,
  collapsedLabel,
  bare = false,
  profile,
  savedEventIds,
}: {
  metroId?: string;
  metroLabel?: string;
  source?: string;
  /** Override the metro-framed heading (e.g. poll-page digest framing). */
  heading?: string;
  /** Render as a tappable one-liner until opened (browse hero). */
  collapsedLabel?: string;
  /** Form-only — no card chrome, heading, or close (digest modal). */
  bare?: boolean;
  /** Family profile — rides along on subscribe so digests pick for the
   * family (ages/interests/budget), not generically. */
  profile?: FamilyProfile | null;
  /** Saved event ids at subscribe time — Monday recap check-in asks. */
  savedEventIds?: string[];
}) {
  type Status = "idle" | "submitting" | "done" | "hidden";
  const [email, setEmail] = useState("");
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status>(() => {
    if (typeof window === "undefined") return "idle";
    try {
      if (window.localStorage.getItem("saturday.newsletterSubscribed") === "1") {
        return "hidden";
      }
      // The bare (modal) variant ignores the card dismissal — the modal has
      // its own dismissal key and its trigger already checks subscription.
      if (
        !bare &&
        window.localStorage.getItem("saturday.newsletterDismissed") === "1"
      ) {
        return "hidden";
      }
    } catch {
      // ignore
    }
    return "idle";
  });
  const [error, setError] = useState<string | null>(null);

  if (status === "hidden") return null;

  function dismiss() {
    setStatus("hidden");
    try {
      window.localStorage.setItem("saturday.newsletterDismissed", "1");
    } catch {
      // ignore
    }
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setError("Enter a valid email.");
      return;
    }
    setError(null);
    setStatus("submitting");
    try {
      // Age band rides along when the family has picked one — stored on the
      // subscriber record (worker) so digests can segment by age. The full
      // family profile (when complete) personalizes the picks themselves.
      const storedAge = SHOW_AGE_BAND_UI ? readStoredAgeBand() : "any";
      await subscribeNewsletter({
        email: trimmed,
        metroId,
        ageBand: storedAge === "any" ? undefined : storedAge,
        ageBands: profile?.ageBands,
        zipCode: profile?.zipCode || undefined,
        interests: profile?.interests,
        budget: profile?.budget === "any" ? undefined : profile?.budget,
        setting: profile?.setting === "any" ? undefined : profile?.setting,
        savedEventIds,
        source,
      });
      setStatus("done");
      try {
        window.localStorage.setItem("saturday.newsletterSubscribed", "1");
      } catch {
        // ignore
      }
      trackMetric("newsletter_subscribed", metroId);
    } catch (e) {
      setStatus("idle");
      setError((e as Error).message || "Subscribe failed — try again.");
    }
  }

  // Explicit, persistent success — never silently vanish after subscribing.
  if (status === "done") {
    const successLine = "You're in — first email lands Friday.";
    return bare ? (
      <p className="newsletter-success" role="status">
        {successLine}
      </p>
    ) : (
      <section className="newsletter-card is-done" aria-label="Friday digest">
        <p className="newsletter-success" role="status">
          <Check aria-hidden="true" /> {successLine}
        </p>
      </section>
    );
  }

  // Collapsed one-liner (browse hero): expands to the form on tap; the X
  // persists the same dismissal as the full card.
  if (collapsedLabel && !open) {
    return (
      <div className="newsletter-inline">
        <button
          type="button"
          className="newsletter-inline-open"
          onClick={() => setOpen(true)}
        >
          <Mail aria-hidden="true" />
          {collapsedLabel}
        </button>
        <button
          type="button"
          className="icon-button newsletter-inline-dismiss"
          title="Hide"
          aria-label="Hide digest signup"
          onClick={dismiss}
        >
          <X aria-hidden="true" />
        </button>
      </div>
    );
  }

  const formBlock = (
    <>
      <form onSubmit={submit} className="newsletter-form">
        <input
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
        />
        <button
          type="submit"
          className="primary-button"
          disabled={status === "submitting"}
        >
          {status === "submitting" ? "Subscribing…" : "Subscribe"}
        </button>
      </form>
      {error && <p className="newsletter-error">{error}</p>}
    </>
  );

  if (bare) {
    return <div className="newsletter-bare">{formBlock}</div>;
  }

  return (
    <section className="newsletter-card" aria-label="Friday weekend digest">
      <button
        type="button"
        className="icon-button newsletter-card-close"
        title="Hide"
        onClick={dismiss}
      >
        <X aria-hidden="true" />
      </button>
      <p className="eyebrow">
        <Mail aria-hidden="true" /> Friday digest
      </p>
      <h3>
        {heading ??
          `5 ${APP_AUDIENCE === "adults" ? "" : "family "}ideas for ${
            metroLabel ?? "your metro"
          } this weekend`}
      </h3>
      <p className="newsletter-sub">
        A short email every Friday morning. Free. Unsubscribe anytime.
      </p>
      {formBlock}
    </section>
  );
}
