import { ArrowLeft, ExternalLink, Frown, Meh, Smile, ThumbsUp } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { APP_BRAND } from "./appConfig";
import {
  EventSummary,
  PollSnapshot,
  StopSummary,
  Vote,
  getOrCreateVoterId,
  getPoll,
  postVote,
  trackMetric,
} from "./api";

type Status = "loading" | "ready" | "error";

const VOTE_LABEL: Record<Vote, string> = {
  up: "Yes",
  down: "Skip",
  meh: "Maybe",
};

const VOTE_ICON: Record<Vote, typeof Smile> = {
  up: Smile,
  meh: Meh,
  down: Frown,
};

const VOTES: Vote[] = ["up", "meh", "down"];

type DisplayItem =
  | { kind: "spot"; id: string; stop: StopSummary }
  | { kind: "event"; id: string; event: EventSummary };

function readMyVotes(pollId: string): Record<string, Vote> {
  try {
    const raw = window.localStorage.getItem(`saturday.votes.${pollId}`);
    return raw ? (JSON.parse(raw) as Record<string, Vote>) : {};
  } catch {
    return {};
  }
}

function storeMyVotes(pollId: string, votes: Record<string, Vote>) {
  window.localStorage.setItem(
    `saturday.votes.${pollId}`,
    JSON.stringify(votes),
  );
}

function formatEventWhen(event: EventSummary): string {
  if (event.startDateTime) {
    const d = new Date(event.startDateTime);
    if (Number.isFinite(d.getTime())) {
      const date = d.toLocaleDateString(undefined, {
        weekday: "short",
        month: "short",
        day: "numeric",
      });
      const time = d.toLocaleTimeString(undefined, {
        hour: "numeric",
        minute: "2-digit",
      });
      return `${date} · ${time}`;
    }
  }
  return event.timeWindow ?? "";
}

export default function PollView({
  pollId,
  embed = false,
}: {
  pollId: string;
  embed?: boolean;
}) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [poll, setPoll] = useState<PollSnapshot | null>(null);
  const [myVotes, setMyVotes] = useState<Record<string, Vote>>(() =>
    readMyVotes(pollId),
  );
  const [submitting, setSubmitting] = useState(false);
  const [trackedVote, setTrackedVote] = useState(false);
  const voterId = useMemo(() => getOrCreateVoterId(), []);

  // Build a single ordered visit list mixing places + events. Honors the
  // poll's itemOrder when present; otherwise falls back to "places, then
  // events" so legacy polls (no events) keep working.
  const displayItems = useMemo<DisplayItem[]>(() => {
    if (!poll) return [];
    const stopMap = new Map(poll.stops.map((s) => [s.id, s] as const));
    const eventMap = new Map(
      (poll.events ?? []).map((e) => [e.id, e] as const),
    );
    const out: DisplayItem[] = [];
    const seen = new Set<string>();
    if (poll.itemOrder && poll.itemOrder.length > 0) {
      for (const ref of poll.itemOrder) {
        const key = `${ref.kind}:${ref.id}`;
        if (seen.has(key)) continue;
        if (ref.kind === "spot") {
          const stop = stopMap.get(ref.id);
          if (stop) {
            seen.add(key);
            out.push({ kind: "spot", id: ref.id, stop });
          }
        } else {
          const event = eventMap.get(ref.id);
          if (event) {
            seen.add(key);
            out.push({ kind: "event", id: ref.id, event });
          }
        }
      }
    }
    for (const stop of poll.stops) {
      const key = `spot:${stop.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "spot", id: stop.id, stop });
    }
    for (const event of poll.events ?? []) {
      const key = `event:${event.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind: "event", id: event.id, event });
    }
    return out;
  }, [poll]);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    getPoll(pollId)
      .then((data) => {
        if (!active) return;
        setPoll(data);
        setStatus("ready");
        trackMetric("poll_viewed", data.metroId);
      })
      .catch((err: Error) => {
        if (!active) return;
        setError(err.message);
        setStatus("error");
      });
    return () => {
      active = false;
    };
  }, [pollId]);

  async function submitVotes(next: Record<string, Vote>) {
    setMyVotes(next);
    storeMyVotes(pollId, next);
    setSubmitting(true);
    try {
      const result = await postVote(pollId, voterId, next);
      setPoll((current) =>
        current
          ? { ...current, tallies: result.tallies, voterCount: result.voterCount }
          : current,
      );
      if (!trackedVote) {
        setTrackedVote(true);
        trackMetric("vote_cast", poll?.metroId);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(itemId: string, choice: Vote) {
    if (!poll) return;
    await submitVotes({ ...myVotes, [itemId]: choice });
  }

  async function voteYesToAll() {
    if (!poll || displayItems.length === 0) return;
    const next = { ...myVotes };
    for (const item of displayItems) {
      next[item.id] = "up";
    }
    await submitVotes(next);
  }

  function backToApp() {
    window.location.hash = "";
  }

  const shellClass = embed ? "poll-shell poll-shell-embed" : "poll-shell";
  const fullPollUrl =
    typeof window === "undefined"
      ? ""
      : `${window.location.origin}${window.location.pathname}#/p/${encodeURIComponent(
          pollId,
        )}`;

  if (status === "loading") {
    return (
      <div className={shellClass}>
        <p className="poll-status">Loading plan…</p>
      </div>
    );
  }

  if (status === "error" || !poll) {
    return (
      <div className={shellClass}>
        <p className="poll-status error">{error ?? "Plan not found."}</p>
        {embed ? (
          <a className="poll-embed-open" href={fullPollUrl} target="_blank" rel="noreferrer">
            Open in {APP_BRAND}
          </a>
        ) : (
          <button className="text-button" onClick={backToApp}>
            <ArrowLeft aria-hidden="true" />
            Back to app
          </button>
        )}
      </div>
    );
  }

  const stopCount = poll.stops.length;
  const eventCount = (poll.events ?? []).length;
  const allYes =
    displayItems.length > 0 &&
    displayItems.every((item) => myVotes[item.id] === "up");

  return (
    <div className={shellClass}>
      <header className="poll-header">
        {!embed && (
          <button className="text-button" onClick={backToApp}>
            <ArrowLeft aria-hidden="true" />
            Back to app
          </button>
        )}
        <p className="eyebrow">Vote on the plan</p>
        <h1>{poll.title}</h1>
        <p className="poll-meta">
          {stopCount} place{stopCount === 1 ? "" : "s"}
          {eventCount > 0
            ? ` · ${eventCount} event${eventCount === 1 ? "" : "s"}`
            : ""}{" "}
          · {poll.voterCount} voter{poll.voterCount === 1 ? "" : "s"}
        </p>
        <button
          className={`vote-yes-all ${allYes ? "is-active" : ""}`}
          onClick={voteYesToAll}
          disabled={submitting || displayItems.length === 0}
          title="Set Yes for every item in this plan"
        >
          <ThumbsUp aria-hidden="true" />
          {allYes ? "Voted Yes to all" : "Yes to all"}
        </button>
      </header>

      <ol className="poll-stops">
        {displayItems.map((item, index) => {
          const tally = poll.tallies[item.id] ?? { up: 0, down: 0, meh: 0 };
          const myChoice = myVotes[item.id];
          if (item.kind === "spot") {
            const stop = item.stop;
            return (
              <li className="poll-stop" key={`spot:${stop.id}`}>
                <div className="poll-stop-head">
                  <span className="plan-stop-index">{index + 1}</span>
                  <div>
                    <strong>{stop.name}</strong>
                    <span>
                      {stop.neighborhood} · {stop.category}
                      {stop.cost ? ` · ${stop.cost}` : ""}
                    </span>
                  </div>
                </div>
                <div className="poll-vote-row">
                  {VOTES.map((value) => {
                    const Icon = VOTE_ICON[value];
                    const active = myChoice === value;
                    return (
                      <button
                        key={value}
                        className={`vote-button vote-${value}${active ? " active" : ""}`}
                        disabled={submitting}
                        onClick={() => vote(stop.id, value)}
                      >
                        <Icon aria-hidden="true" />
                        <span>{VOTE_LABEL[value]}</span>
                        <em>{tally[value]}</em>
                      </button>
                    );
                  })}
                </div>
              </li>
            );
          }
          const event = item.event;
          return (
            <li className="poll-stop poll-stop-event" key={`event:${event.id}`}>
              <div className="poll-stop-head">
                <span className="plan-stop-index plan-stop-index-event">
                  {index + 1}
                </span>
                <div>
                  <strong>
                    <span className="plan-event-tag">EVENT</span> {event.title}
                  </strong>
                  <span>
                    {formatEventWhen(event)}
                    {event.venue ? ` · ${event.venue}` : ""}
                    {event.cost ? ` · ${event.cost}` : ""}
                  </span>
                  {event.url && (
                    <a
                      className="poll-event-link"
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink aria-hidden="true" />
                      Event page
                    </a>
                  )}
                </div>
              </div>
              <div className="poll-vote-row">
                {VOTES.map((value) => {
                  const Icon = VOTE_ICON[value];
                  const active = myChoice === value;
                  return (
                    <button
                      key={value}
                      className={`vote-button vote-${value}${active ? " active" : ""}`}
                      disabled={submitting}
                      onClick={() => vote(event.id, value)}
                    >
                      <Icon aria-hidden="true" />
                      <span>{VOTE_LABEL[value]}</span>
                      <em>{tally[value]}</em>
                    </button>
                  );
                })}
              </div>
            </li>
          );
        })}
      </ol>

      {embed ? (
        <footer className="poll-embed-footer">
          <span>{APP_BRAND}</span>
          <a href={fullPollUrl} target="_blank" rel="noreferrer">
            Open full plan
          </a>
        </footer>
      ) : (
        <section className="poll-cta" aria-label="Make your own plan">
          <h2>Like this kind of plan?</h2>
          <p>
            Pick a vibe, get a 3-stop family Saturday in seconds, then share a vote
            link of your own — no 11am "what are we doing today" debate.
          </p>
          <button
            type="button"
            className="primary-button wide"
            onClick={backToApp}
          >
            Make your own plan with {APP_BRAND}
          </button>
          <p className="poll-cta-sub">Free · no signup needed</p>
        </section>
      )}
    </div>
  );
}
