// Post-weekend "did you go?" prompt — one saved event at a time, answered
// with Worth it! / Skip it / Didn't go. Rendered by App inside the standard
// modal backdrop; the queue itself lives in checkinQueue.ts.

import { ThumbsDown, ThumbsUp } from "lucide-react";
import type { FamilyEvent } from "./App";

type Props = {
  event: FamilyEvent;
  /** Total prompts in this queue (for the progress dots). */
  queueLength: number;
  /** How many prompts have already been answered. */
  answered: number;
  /** went: true = worth it, false = skip it, null = didn't go (no feedback). */
  onAnswer: (went: boolean | null) => void;
};

export default function CheckinPrompt({
  event,
  queueLength,
  answered,
  onAnswer,
}: Props) {
  return (
    <div className="modal-backdrop checkin-backdrop" role="presentation">
      <div
        className="checkin-prompt"
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkin-title"
      >
        <p className="eyebrow">How was your weekend?</p>
        <h2 id="checkin-title">Did you go to this?</h2>
        <p className="checkin-event">
          <strong>{event.title}</strong>
          <span>
            {[event.venue, event.city].filter(Boolean).join(" · ")}
          </span>
        </p>
        <div className="checkin-actions">
          <button
            type="button"
            className="primary-button"
            onClick={() => onAnswer(true)}
          >
            <ThumbsUp aria-hidden="true" /> Worth it!
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => onAnswer(false)}
          >
            <ThumbsDown aria-hidden="true" /> Skip it
          </button>
          <button
            type="button"
            className="text-button"
            onClick={() => onAnswer(null)}
          >
            Didn&rsquo;t go
          </button>
        </div>
        <div className="checkin-progress" aria-hidden="true">
          {Array.from({ length: queueLength }, (_, i) => (
            <span key={i} className={i <= answered ? "active" : ""} />
          ))}
        </div>
      </div>
    </div>
  );
}
