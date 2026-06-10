// NewsletterCard: the silent-success bug fix (explicit "You're in" state that
// stays mounted), the collapsed one-liner used below the browse hero, and the
// persisted dismissal/subscription gates.
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../src/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/api")>();
  return {
    ...actual,
    subscribeNewsletter: vi.fn(async () => ({ ok: true })),
    trackMetric: vi.fn(),
  };
});

import { NewsletterCard } from "../src/App";
import { subscribeNewsletter } from "../src/api";

const SUCCESS = /you're in — first email lands friday\./i;

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(subscribeNewsletter).mockClear();
});

afterEach(() => {
  cleanup();
});

async function subscribeVia(input: HTMLElement) {
  fireEvent.change(input, { target: { value: "kai@example.com" } });
  fireEvent.click(screen.getByRole("button", { name: /subscribe/i }));
  await screen.findByText(SUCCESS);
}

describe("NewsletterCard", () => {
  it("renders nothing when this browser already subscribed", () => {
    window.localStorage.setItem("saturday.newsletterSubscribed", "1");
    const { container } = render(
      <NewsletterCard metroId="bay-area" metroLabel="Bay Area" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when previously dismissed", () => {
    window.localStorage.setItem("saturday.newsletterDismissed", "1");
    const { container } = render(
      <NewsletterCard metroId="bay-area" metroLabel="Bay Area" />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("subscribe shows an explicit success state instead of unmounting", async () => {
    render(<NewsletterCard metroId="bay-area" metroLabel="Bay Area" />);
    await subscribeVia(screen.getByPlaceholderText("you@example.com"));
    expect(screen.getByRole("status")).toHaveTextContent(SUCCESS);
    expect(
      window.localStorage.getItem("saturday.newsletterSubscribed"),
    ).toBe("1");
    expect(subscribeNewsletter).toHaveBeenCalledWith({
      email: "kai@example.com",
      metroId: "bay-area",
      source: "app-plans",
    });
  });

  it("collapsed mode stays a one-liner until tapped, then submits with its source", async () => {
    render(
      <NewsletterCard
        metroId="bay-area"
        metroLabel="Bay Area"
        source="app-browse"
        collapsedLabel="Get 5 family things to do every Friday"
      />,
    );
    expect(
      screen.queryByPlaceholderText("you@example.com"),
    ).not.toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", {
        name: /get 5 family things to do every friday/i,
      }),
    );
    await subscribeVia(screen.getByPlaceholderText("you@example.com"));
    expect(subscribeNewsletter).toHaveBeenCalledWith(
      expect.objectContaining({ source: "app-browse" }),
    );
  });

  it("dismissing the one-liner persists in localStorage", () => {
    render(
      <NewsletterCard
        metroId="bay-area"
        metroLabel="Bay Area"
        collapsedLabel="Get 5 family things to do every Friday"
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /hide digest signup/i }),
    );
    expect(window.localStorage.getItem("saturday.newsletterDismissed")).toBe(
      "1",
    );
    expect(
      screen.queryByRole("button", { name: /get 5 family/i }),
    ).not.toBeInTheDocument();
  });

  it("bare (modal) variant ignores the card dismissal but honors subscription", () => {
    window.localStorage.setItem("saturday.newsletterDismissed", "1");
    render(<NewsletterCard metroId="bay-area" source="visit-prompt" bare />);
    expect(
      screen.getByPlaceholderText("you@example.com"),
    ).toBeInTheDocument();
  });
});
