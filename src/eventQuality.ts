// Junk-event gate for the weekend feed. Detects listings that are NOT
// family-weekend material (teen committee meetings, tutoring services,
// library board business, adult volunteer logistics, test-prep noise) so cold
// traffic never lands on them. Conservative by design: real family programs
// (storytime, Lego club, craft, teen movie night) must pass untouched.
import type { FamilyEvent } from "./App";

export function isFeedJunkEvent(event: FamilyEvent): boolean {
  const title = (event.title ?? "").toLowerCase();
  const text = `${title} ${event.description ?? ""} ${event.venue ?? ""}`.toLowerCase();
  return (
    // Advisory/committee in the title is planning business, not programming —
    // regardless of the audience it claims to serve.
    /\b(advisory|committee)\b/.test(title) ||
    /teen (advisory|council|committee|leadership)/.test(text) ||
    /youth (council|advisory|commission)/.test(text) ||
    /homework (help|club|center)/.test(text) ||
    /tutoring/.test(text) ||
    /friends of the (library|museum)/.test(text) ||
    /board meeting/.test(text) ||
    /library (association|trustees)/.test(text) ||
    /volunteer orientation/.test(text) ||
    /planning meeting/.test(text) ||
    /staff meeting/.test(text) ||
    /test prep/.test(text) ||
    /civics test/.test(text) ||
    /citizenship (test|class)/.test(text)
  );
}
