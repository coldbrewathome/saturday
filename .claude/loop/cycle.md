# Planner+Doer cycle — per-tick runbook

This file is read by the autonomous loop on each wakeup. Execute the steps below in order, then schedule the next wakeup.

**Repo:** `/Users/kning/Projects/saturday`
**Cadence:** ~25 min between ticks (1500s).
**Authorization recap:** Planner edits `ROADMAP.md` only. Doer commits code locally only — never pushes, never deploys, never edits `ROADMAP.md`. Doer makes best-call on ambiguity and documents in commit body.

## Step 1 — Planner (foreground)

Spawn an `Agent` with:
- `subagent_type: "general-purpose"`
- `description: "Planner tick"`
- `prompt`: `"You are the Planner agent for /Users/kning/Projects/saturday. Read /Users/kning/Projects/saturday/.claude/loop/planner.md and follow it exactly. Today's date is in your environment context. Report per the format in that file."`

Wait for it to complete. Capture: did it commit (SHA)? Did it report "no changes"? What did it say the Doer should pick up?

## Step 2 — Doer (foreground, conditional)

If the Planner says Now is empty AND has nothing to promote → skip the Doer this tick; the Doer would only report "no work" anyway. Treat this as an idle tick (see Step 4).

Otherwise spawn an `Agent` with:
- `subagent_type: "general-purpose"`
- `description: "Doer tick"`
- `prompt`: `"You are the Doer agent for /Users/kning/Projects/saturday. Read /Users/kning/Projects/saturday/.claude/loop/doer.md and follow it exactly. Report per the format in that file."`

Wait for it to complete. Capture: which task did it pick? Did it commit (SHA)? Did it report "no work"? Did it flag a `TODO(human)`?

## Step 3 — Single-line tick summary

Write one user-facing line summarizing this tick: `Tick N: planner=<action/sha or no-op> · doer=<task or no-work/sha> · todo-human=<count>`. Keep it short — the user will see a wall of these if the loop runs all day.

## Step 4 — Idle-stop detection

If THIS tick was idle (Planner reported no changes AND Doer was skipped or reported "no work"):
- Check `git log --since="90 minutes ago" --oneline` — if there are no Planner/Doer commits (no `roadmap:` or task-implementation commits) in the last 90 min, that's 3+ consecutive idle ticks at this cadence.
- If yes: send a `PushNotification` with body `"FamHop planner+doer loop idle — nothing in Now to act on. Stopping."` and DO NOT call ScheduleWakeup. The loop ends.

Otherwise (productive tick OR <90 min of quiet): continue to Step 5.

## Step 5 — Schedule next tick

Call `ScheduleWakeup`:
- `delaySeconds: 1500`
- `prompt: "Run the Planner+Doer cycle at /Users/kning/Projects/saturday/.claude/loop/cycle.md"`
- `reason: "next planner+doer tick — <doer task or 'idle check'>"`

## If the user types something between ticks

The user's message takes priority. Handle it first. If they say "stop the loop", omit the ScheduleWakeup. If they redirect ("work on X instead"), edit `ROADMAP.md` per their direction yourself (or have the next Planner tick do it), then resume the cycle.

## Notes for the loop operator (you, the parent agent)

- Do NOT do the Planner's or Doer's work yourself in your own context. Spawn the agents. Your job is orchestration + reporting + scheduling.
- Both agents return short summaries — keep them as your text output verbatim is too noisy; distill to the single-line tick summary in Step 3.
- If an agent errors out or returns nonsense, report it in the tick summary (`planner=ERROR`) and schedule the next tick anyway. One bad tick shouldn't kill the loop.
