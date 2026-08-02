import { describe, expect, it } from "vitest";
import {
  lastWeekendWindow,
  renderMondayRecap,
  type DigestEvent,
} from "../worker/src/newsletter-template";

// A Monday: the just-ended weekend is Sat Aug 1 + Sun Aug 2, the upcoming
// weekend is Aug 8–9 (America/New_York).
const MONDAY = new Date("2026-08-03T09:00:00-04:00");

const saved: DigestEvent[] = [
  {
    id: "fest",
    title: "Neighborhood Festival",
    venue: "Central Park",
    startDateTime: "2026-08-01T13:00:00-04:00",
    url: "https://example.org/fest",
  },
];

const upcoming: DigestEvent[] = [
  {
    id: "museum",
    title: "Hands-on Science Day",
    venue: "Children's Museum",
    startDateTime: "2026-08-08T10:00:00-04:00",
    url: "https://example.org/museum",
    cost: "Free",
  },
];

describe("lastWeekendWindow", () => {
  it("on Monday returns the previous Sat+Sun", () => {
    const window = lastWeekendWindow(MONDAY, "America/New_York");
    expect(window.saturdayKey).toBe("2026-08-01");
    expect(window.sundayKey).toBe("2026-08-02");
    expect(window.label).toBe("Aug 1–2");
  });

  it("on Sunday evening returns today + yesterday", () => {
    const sunday = new Date("2026-08-02T19:00:00-04:00");
    const window = lastWeekendWindow(sunday, "America/New_York");
    expect(window.saturdayKey).toBe("2026-08-01");
    expect(window.sundayKey).toBe("2026-08-02");
  });
});

describe("renderMondayRecap", () => {
  const base = {
    metroId: "new-york-city",
    metroLabel: "New York City",
    timezone: "America/New_York",
    savedEvents: saved,
    trusted: [{ title: "Neighborhood Festival", trustScore: 92, url: "https://example.org/fest" }],
    upcoming,
    now: MONDAY,
    siteBaseUrl: "https://famhop.com",
  };

  it("produces a recap subject and all three sections", () => {
    const recap = renderMondayRecap(base);
    expect(recap.subject).toContain("How was your weekend?");
    expect(recap.subject).toContain("New York City");
    expect(recap.html).toContain("Did you go to Neighborhood Festival?");
    expect(recap.html).toContain("92%");
    expect(recap.html).toContain("Hands-on Science Day");
  });

  it("includes the check-in deep link for saved events", () => {
    const recap = renderMondayRecap(base);
    expect(recap.html).toContain("famhop.com/new-york-city?checkin=1");
  });

  it("handles empty saved events and trusted gracefully", () => {
    const recap = renderMondayRecap({ ...base, savedEvents: [], trusted: [] });
    expect(recap.html).toContain("Nothing saved last weekend");
    expect(recap.html).toContain("Not enough families have checked in yet");
  });

  it("renders plain-text mirror with the same sections", () => {
    const recap = renderMondayRecap(base);
    expect(recap.text).toContain("DID YOU GO?");
    expect(recap.text).toContain("92% said Neighborhood Festival was worth it");
    expect(recap.text).toContain("COMING UP THIS WEEKEND (Aug 8–9)");
  });

  it("renders the unsubscribe link when provided", () => {
    const recap = renderMondayRecap({
      ...base,
      unsubscribeUrl: "https://api.example/newsletter/unsubscribe?email=a%40b.c&token=x",
    });
    expect(recap.html).toContain("Unsubscribe with one click");
  });
});
