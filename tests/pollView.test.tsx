// PollView: the "Verified · {host} · {date}" trust line on event stop cards
// and the Friday-digest signup that mounts only after a vote is cast.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PollSnapshot } from "../src/api";

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    getPoll: vi.fn(),
    postVote: vi.fn(async () => ({ tallies: {}, voterCount: 1 })),
    subscribeNewsletter: vi.fn(async () => ({ ok: true })),
    trackMetric: vi.fn(),
  };
});

import PollView from "../src/PollView";
import { getPoll } from "../src/api";

const SNAPSHOT: PollSnapshot = {
  pollId: "abc123",
  metroId: "bay-area",
  title: "Saturday in the Mission",
  stops: [
    { id: "s1", name: "Dolores Park", neighborhood: "Mission", category: "Outdoors" },
  ],
  events: [
    {
      id: "e1",
      title: "Family Storytime",
      venue: "Main Library",
      city: "San Francisco",
      startDateTime: "2026-06-13T10:30:00",
      url: "https://www.sfpl.org/events/storytime",
    },
    {
      id: "e2",
      title: "Mystery Meetup",
      venue: "Somewhere",
      city: "San Francisco",
      url: "not-a-url",
    },
  ],
  tallies: {},
  voterCount: 0,
  createdAt: "2026-06-09T00:00:00Z",
};

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(getPoll).mockResolvedValue(SNAPSHOT);
});

afterEach(() => {
  cleanup();
});

describe("PollView", () => {
  it("renders the verified trust line for events with a parseable source URL", async () => {
    render(<PollView pollId="abc123" />);
    const trustLine = await screen.findByRole("link", {
      name: /verified · sfpl\.org · jun 13/i,
    });
    expect(trustLine).toHaveAttribute(
      "href",
      "https://www.sfpl.org/events/storytime",
    );
    expect(trustLine).toHaveAttribute("target", "_blank");
    expect(trustLine.getAttribute("rel")).toContain("noopener");
  });

  it("falls back to a plain 'Event page' label when the URL has no hostname", async () => {
    render(<PollView pollId="abc123" />);
    expect(
      await screen.findByRole("link", { name: /event page/i }),
    ).toBeInTheDocument();
  });

  it("mounts the digest signup only after a vote is cast", async () => {
    render(<PollView pollId="abc123" />);
    await screen.findByText("Saturday in the Mission");
    expect(
      screen.queryByText(/get 5 family things to do every friday/i),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /yes to all/i }));
    expect(
      await screen.findByText(/get 5 family things to do every friday/i),
    ).toBeInTheDocument();
  });
});
