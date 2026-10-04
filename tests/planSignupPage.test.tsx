import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import PlanSignupPage from "../src/PlanSignupPage";
import type { MetroConfig } from "../src/metros";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.resetModules();
});

const metro: MetroConfig = {
  id: "bay-area",
  label: "Bay Area",
  dataDir: "bay-area",
  timezone: "America/Los_Angeles",
  canonicalPath: "/bay-area",
} as MetroConfig;

function makeEvent(
  overrides: Partial<{
    title: string;
    venue: string;
    cost: string;
    startDateTime: string;
  }> = {},
) {
  return {
    id: "evt-" + Math.random().toString(36).slice(2, 8),
    title: "Family Festival",
    description: "",
    venue: "Downtown",
    city: "Fremont",
    neighborhood: "Downtown",
    lat: 37.5,
    lon: -122.0,
    category: "Festival",
    daysOfWeek: [6],
    timeWindow: "Afternoon",
    startDateTime: `${key(START)}T${hhmm(START)}:00-07:00`,
    endDateTime: `${key(END)}T${hhmm(END)}:00-07:00`,
    ageBands: [],
    cost: "Free",
    url: "https://example.com/e",
    verified: true,
    ...overrides,
  };
}

// Same upcoming-Saturday math as the component's weekendKeys (never
// yesterday, unlike the weekend feed) — teaser fixtures must stay inside the
// window on any run day, not on a pinned calendar date.
const daysToSat = new Date().getDay() === 6 ? 0 : (6 - new Date().getDay() + 7) % 7;
const SAT = new Date();
SAT.setHours(0, 0, 0, 0);
SAT.setDate(SAT.getDate() + daysToSat);
const key = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
const satKey = key(SAT);
const nextSatKey = key(new Date(SAT.getFullYear(), SAT.getMonth(), SAT.getDate() + 7));
const hhmm = (d: Date) =>
  `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;

// ...and inside it at any run *time*: the page drops events that have already
// started, so a Saturday-evening run must not mint a fixture at a fixed 17:00
// that is now in the past. Anchor the start an hour out when needed; rolling
// past midnight just lands the event on Sunday, which the window accepts.
function anchorStart(now: Date): Date {
  const sat = new Date(now);
  const dow = now.getDay();
  sat.setHours(0, 0, 0, 0);
  sat.setDate(sat.getDate() + (dow === 6 ? 0 : (6 - dow + 7) % 7));
  return new Date(Math.max(sat.getTime() + 17 * 3_600_000, now.getTime() + 3_600_000));
}
const START = anchorStart(new Date());
const END = new Date(START.getTime() + 4 * 3_600_000);

const WEEKEND_EVENTS = {
  events: [
    makeEvent({ title: "Fireworks Festival", cost: "Free" }),
    makeEvent({ title: "Storytime at the Library", cost: "Free" }),
    makeEvent({ title: "Saturday Concert in the Park", cost: "$" }),
    makeEvent({ title: "Teen Advisory Council", cost: "Free" }),
    makeEvent({ title: "Next Week Event", startDateTime: `${nextSatKey}T13:00:00-07:00` }),
  ],
};

function mockDataFetch() {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (String(url).includes("events.json")) {
        return { ok: true, status: 200, json: async () => WEEKEND_EVENTS } as Response;
      }
      if (String(url).includes("/newsletter")) {
        return { ok: true, status: 200, json: async () => ({ ok: true }) } as Response;
      }
      return { ok: true, status: 200, json: async () => ({}) } as Response;
    }),
  );
}

// Regression pin: a Saturday-evening run (CI hit this at 22:00 PT, 2026-10-03)
// must not build a fixture the page's "already started" filter drops.
describe("teaser fixture slot", () => {
  it("stays upcoming and inside the weekend window at any run time", () => {
    const satEvening = new Date(2026, 9, 3, 22, 0, 0);
    const satStart = anchorStart(satEvening);
    expect(satStart.getTime()).toBeGreaterThan(satEvening.getTime());
    expect([key(satEvening), key(new Date(2026, 9, 4))]).toContain(key(satStart));

    const wednesday = new Date(2026, 9, 7, 9, 0, 0);
    const wedStart = anchorStart(wednesday);
    expect(key(wedStart)).toBe("2026-10-10"); // the coming Saturday, at 17:00
    expect(hhmm(wedStart)).toBe("17:00");
  });
});

describe("PlanSignupPage", () => {
  it("renders the capture headline, form, and metro-framed teasers", async () => {
    vi.stubEnv("VITE_POLLS_API", "https://api.test");
    mockDataFetch();
    render(<PlanSignupPage metro={metro} />);

    expect(screen.getByText(/Your family.s weekend plan/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Get my weekend plan/ }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("Fireworks Festival")).toBeInTheDocument();
    });
    expect(screen.getByText("Saturday Concert in the Park")).toBeInTheDocument();
    // Junk (teen council) and off-weekend events never become teasers.
    expect(screen.queryByText("Teen Advisory Council")).not.toBeInTheDocument();
    expect(screen.queryByText("Next Week Event")).not.toBeInTheDocument();
  });

  it("subscribes the email with metro + source and shows success", async () => {
    vi.stubEnv("VITE_POLLS_API", "https://api.test");
    mockDataFetch();
    render(<PlanSignupPage metro={metro} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "sarah@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Get my weekend plan/ }));

    await waitFor(() => {
      expect(screen.getByText(/You.re in!/)).toBeInTheDocument();
    });
    const subscribeCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes("/newsletter"));
    expect(subscribeCall).toBeDefined();
    const body = JSON.parse(String(subscribeCall![1]?.body));
    expect(body.email).toBe("sarah@example.com");
    expect(body.metroId).toBe("bay-area");
    expect(body.source).toBe("ad-landing");
  });

  it("rejects an invalid email without calling the API", async () => {
    vi.stubEnv("VITE_POLLS_API", "https://api.test");
    mockDataFetch();
    render(<PlanSignupPage metro={metro} />);

    fireEvent.change(screen.getByLabelText("Email address"), {
      target: { value: "not-an-email" },
    });
    fireEvent.submit(document.querySelector("form")!);

    expect(await screen.findByText("Enter a valid email.")).toBeInTheDocument();
    const subscribeCall = vi
      .mocked(fetch)
      .mock.calls.find(([url]) => String(url).includes("/newsletter"));
    expect(subscribeCall).toBeUndefined();
  });
});
