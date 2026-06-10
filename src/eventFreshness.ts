// Render-time freshness gate for event suggestions. Every surface that offers
// an event as a *suggestion* (editor's-pick forks, the ?guidePlan= handoff,
// planner candidates, Hop Now, browse map/list, "nearby this weekend" rails)
// must pass events through isUpcomingEvent so a past event never renders as
// something you could still go to.

type FreshnessEvent = {
  startDateTime?: string | null;
  endDateTime?: string | null;
};

export function isUpcomingEvent(
  event: FreshnessEvent,
  now: Date = new Date(),
): boolean {
  if (!event.startDateTime) return true; // recurring series keep recurring
  const start = new Date(event.startDateTime);
  if (Number.isNaN(start.getTime())) return false;
  const end = event.endDateTime ? new Date(event.endDateTime) : null;
  if (end && !Number.isNaN(end.getTime())) {
    return end.getTime() >= now.getTime();
  }
  if (start.getTime() >= now.getTime()) return true;
  // Started with no listed end: treat as plausibly still running only while
  // it's the same local day — an afternoon festival shouldn't vanish at its
  // start minute, but yesterday's event must never resurface as upcoming.
  return (
    start.getFullYear() === now.getFullYear() &&
    start.getMonth() === now.getMonth() &&
    start.getDate() === now.getDate()
  );
}

// The "Weekend" When-filter window: Friday evening (5pm+) through Sunday.
// A Friday-night plan is weekend territory; the chip is labeled
// "Weekend (Fri–Sun)" to match.
export function isWeekendWindowDate(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 0 || dow === 6) return true;
  return dow === 5 && date.getHours() >= 17;
}
