// Date + event-label helpers, extracted from App.tsx (2026-08). Pure
// functions only — no app state, no DOM writes.
import { isUpcomingEvent } from "./eventFreshness";
import type {
  Category,
  Cost,
  FamilyEvent,
  SavedEventDateGroup,
} from "./types";
import type { AgeBand } from "./planner";

export function optionLabel<T extends string>(
  options: Array<{ id: T; label: string }>,
  id: T,
): string {
  return options.find((option) => option.id === id)?.label ?? id;
}

const SHORT_DAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// True when an event is no longer upcoming. Delegates to the shared
// freshness gate (src/eventFreshness.ts) instead of a start+/-6h heuristic —
// that heuristic both showed a just-ended short event as attendable (start
// less than 6h ago) and marked a live multi-day exhibition "Past" the day
// after it opened (start more than 6h ago, endDateTime ignored entirely).
export function isEventExpired(
  event: { startDateTime?: string | null; endDateTime?: string | null },
  now: Date = new Date(),
  timeZone?: string,
): boolean {
  return !isUpcomingEvent(event, now, { timeZone });
}

export function dayWindowLabel(days: number[]): string {
  if (!days || days.length === 0) return "Weekly";
  if (days.length === 1) return SHORT_DAY[days[0]] ?? "Weekly";
  const sorted = [...days].sort((a, b) => a - b);
  return sorted.map((d) => SHORT_DAY[d] ?? "?").join(" / ");
}

export function validEventDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function sameLocalDate(left: Date, right: Date): boolean {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

export function eventDateGroupLabel(event: FamilyEvent): string {
  const date = validEventDate(event.startDateTime);
  if (!date) {
    return `${dayWindowLabel(event.daysOfWeek)} events`;
  }
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "short",
    day: "numeric",
  });
}

export function eventTimeLabel(event: FamilyEvent): string | null {
  const start = validEventDate(event.startDateTime);
  if (!start) return null;
  const end = validEventDate(event.endDateTime);
  const formatter = new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  if (
    end &&
    sameLocalDate(start, end) &&
    start.getHours() === 0 &&
    start.getMinutes() === 0 &&
    end.getTime() - start.getTime() >= 23 * 60 * 60 * 1000
  ) {
    return "All day";
  }
  if (end && sameLocalDate(start, end) && end.getTime() > start.getTime()) {
    return `${formatter.format(start)} - ${formatter.format(end)}`;
  }
  return formatter.format(start);
}

export function groupSavedEventsByDate(events: FamilyEvent[]): SavedEventDateGroup[] {
  const groups = new Map<string, SavedEventDateGroup>();
  for (const event of events) {
    const date = validEventDate(event.startDateTime);
    const key = date ? isoDate(date) : `recurring-${dayWindowLabel(event.daysOfWeek)}`;
    const sortTime = date
      ? new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
      : Infinity;
    const group = groups.get(key) ?? {
      key,
      label: eventDateGroupLabel(event),
      sortTime,
      events: [],
    };
    group.events.push(event);
    groups.set(key, group);
  }
  return Array.from(groups.values()).sort(
    (left, right) => left.sortTime - right.sortTime || left.label.localeCompare(right.label),
  );
}

export function weatherTone(label: string): "wet" | "dry" | "mixed" {
  const wet = ["Rainy", "Drizzly", "Stormy", "Showers", "Snowy"];
  const dry = ["Clear", "Mostly sunny"];
  if (wet.includes(label)) return "wet";
  if (dry.includes(label)) return "dry";
  return "mixed";
}

export function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseIsoDate(value: string): Date {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function nextDayOfWeek(target: number, from: Date = new Date()): Date {
  const offset = (target - from.getDay() + 7) % 7 || 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
}

export function thisOrNextDayOfWeek(target: number, from: Date = new Date()): Date {
  const offset = (target - from.getDay() + 7) % 7;
  return new Date(from.getFullYear(), from.getMonth(), from.getDate() + offset);
}

export function addLocalDays(date: Date, days: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
}

export function nextBoaWeekend(now: Date = new Date()): { saturday: Date; sunday: Date } {
  let year = now.getFullYear();
  let month = now.getMonth();
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const firstOfMonth = new Date(year, month, 1);
    const offset = (6 - firstOfMonth.getDay() + 7) % 7;
    const saturday = new Date(year, month, 1 + offset);
    const sunday = new Date(year, month, 2 + offset);
    if (sunday.getMonth() === month) {
      const sundayEnd = new Date(year, month, 2 + offset, 23, 59, 59);
      if (sundayEnd >= now) {
        return { saturday, sunday };
      }
    }
    month += 1;
    if (month > 11) {
      month = 0;
      year += 1;
    }
  }
  const fallback = new Date(year, month, 1);
  return { saturday: fallback, sunday: fallback };
}

export function formatWeekendRange(saturday: Date, sunday: Date): string {
  const monthName = saturday.toLocaleDateString("en-US", { month: "short" });
  if (saturday.getMonth() === sunday.getMonth()) {
    return `${monthName} ${saturday.getDate()}–${sunday.getDate()}`;
  }
  const sundayMonth = sunday.toLocaleDateString("en-US", { month: "short" });
  return `${monthName} ${saturday.getDate()} – ${sundayMonth} ${sunday.getDate()}`;
}

export function eventWhenLabel(event: FamilyEvent): string {
  if (!event.startDateTime) {
    return `${dayWindowLabel(event.daysOfWeek)} · ${event.timeWindow}`;
  }
  const date = new Date(event.startDateTime);
  if (Number.isNaN(date.getTime())) {
    return `${dayWindowLabel(event.daysOfWeek)} · ${event.timeWindow}`;
  }
  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

export function eventCategoryToSpotCategory(category: string): Category {
  if (/\b(music|comedy|nightclub|bar|dj|concert)\b/i.test(category)) return "Nightlife";
  if (/\b(library|museum|ticketed)\b/i.test(category)) return "Culture";
  if (/\b(park|farm|zoo|garden|nature)\b/i.test(category)) return "Outdoors";
  return "Culture";
}

export function eventCostToSpotCost(cost: string): Cost {
  if (cost === "Free" || cost === "$" || cost === "$$" || cost === "$$$") {
    return cost;
  }
  if (/free/i.test(cost)) return "Free";
  if (/\$\$\$/.test(cost)) return "$$$";
  if (/\$\$/.test(cost)) return "$$";
  if (/\$/.test(cost)) return "$";
  return "Unknown";
}

export function isActualPlanningEvent(
  event: FamilyEvent,
  now: Date,
  selectedAgeBand: AgeBand | "any",
  timeZone?: string,
): boolean {
  if (!event.verified || event.sourceMode === "recurring-template") return false;
  if (!event.startDateTime) return false;
  if (!isUpcomingEvent(event, now, { timeZone })) return false;
  const start = new Date(event.startDateTime);
  if (Number.isNaN(start.getTime())) return false;
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + 45 * 24 * 60 * 60 * 1000);
  if (start < today || start > horizon) return false;
  const day = start.getDay();
  if (day !== 0 && day !== 6) return false;
  if (selectedAgeBand !== "any" && !event.ageBands.includes(selectedAgeBand)) {
    return false;
  }
  return true;
}
