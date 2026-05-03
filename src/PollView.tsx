import { ArrowLeft, Frown, Meh, Smile } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  PollSnapshot,
  Vote,
  getOrCreateVoterId,
  getPoll,
  postVote,
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

export default function PollView({ pollId }: { pollId: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [poll, setPoll] = useState<PollSnapshot | null>(null);
  const [myVotes, setMyVotes] = useState<Record<string, Vote>>(() =>
    readMyVotes(pollId),
  );
  const [submitting, setSubmitting] = useState(false);
  const voterId = useMemo(() => getOrCreateVoterId(), []);

  useEffect(() => {
    let active = true;
    setStatus("loading");
    getPoll(pollId)
      .then((data) => {
        if (!active) return;
        setPoll(data);
        setStatus("ready");
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

  async function vote(stopId: string, choice: Vote) {
    if (!poll) return;
    const next = { ...myVotes, [stopId]: choice };
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
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function backToApp() {
    window.location.hash = "";
  }

  if (status === "loading") {
    return (
      <div className="poll-shell">
        <p className="poll-status">Loading plan…</p>
      </div>
    );
  }

  if (status === "error" || !poll) {
    return (
      <div className="poll-shell">
        <p className="poll-status error">{error ?? "Plan not found."}</p>
        <button className="text-button" onClick={backToApp}>
          <ArrowLeft aria-hidden="true" />
          Back to app
        </button>
      </div>
    );
  }

  return (
    <div className="poll-shell">
      <header className="poll-header">
        <button className="text-button" onClick={backToApp}>
          <ArrowLeft aria-hidden="true" />
          Back to app
        </button>
        <p className="eyebrow">Vote on the plan</p>
        <h1>{poll.title}</h1>
        <p className="poll-meta">
          {poll.stops.length} stop{poll.stops.length === 1 ? "" : "s"} ·{" "}
          {poll.voterCount} voter{poll.voterCount === 1 ? "" : "s"}
        </p>
      </header>

      <ol className="poll-stops">
        {poll.stops.map((stop, index) => {
          const tally = poll.tallies[stop.id] ?? { up: 0, down: 0, meh: 0 };
          const myChoice = myVotes[stop.id];
          return (
            <li className="poll-stop" key={stop.id}>
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
                      className={active ? "vote-button active" : "vote-button"}
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
        })}
      </ol>
    </div>
  );
}
