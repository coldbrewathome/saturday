// Pure logic for the post-weekend check-in queue: which saved events deserve
// a "did you go?" prompt. Kept out of App.tsx so the window/answer rules are
// unit-testable (mirrors hopNow.ts).

import type { FamilyEvent } from "./App";
import { isUpcomingEvent } from "./eventFreshness";

export type CheckinAnswer = { date: string; worthIt: boolean };

export const CHECKIN_PROMPT_MAX = 3;

export function inCheckinWindow(now: Date): boolean {
  const dow = now.getDay();
  // Sunday before 6pm the weekend hasn't finished; Wed-Sat the weekend is
  // too far past to prompt about.
  if (dow === 0 && now.getHours() < 18) return false;
  return dow < 3;
}

export function computeCheckinCandidates(
  events: FamilyEvent[],
  savedEventIds: string[],
  checkins: Record<string, CheckinAnswer>,
  now: Date,
  timeZone: string,
): FamilyEvent[] {
  if (!inCheckinWindow(now)) return [];
  const weekAgo = new Date(now);
  weekAgo.setDate(weekAgo.getDate() - 8);
  return events
    .filter(
      (e) =>
        savedEventIds.includes(e.id) &&
        typeof e.startDateTime === "string" &&
        !checkins[e.id] &&
        !isUpcomingEvent(e, now, { timeZone }) &&
        new Date(e.startDateTime).getTime() >= weekAgo.getTime(),
    )
    .slice(0, CHECKIN_PROMPT_MAX);
}
