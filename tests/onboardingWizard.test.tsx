import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import OnboardingWizard from "../src/OnboardingWizard";

afterEach(() => {
  cleanup();
});

describe("OnboardingWizard", () => {
  it("shows the family screen first with age chips and ZIP field", () => {
    render(<OnboardingWizard onComplete={() => {}} onDismiss={() => {}} />);
    expect(screen.getByText("Who's in your family?")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Kids' ages" })).toBeInTheDocument();
    expect(screen.getByLabelText("Your ZIP (for near-you picks)")).toBeInTheDocument();
  });

  it("collects selections and completes with a full profile", () => {
    const onComplete = vi.fn();
    render(<OnboardingWizard onComplete={onComplete} onDismiss={() => {}} />);

    // Ages: multi-select toddler + preschool.
    fireEvent.click(screen.getByRole("button", { name: "0–2" }));
    fireEvent.click(screen.getByRole("button", { name: "3–5" }));
    fireEvent.change(screen.getByLabelText("Your ZIP (for near-you picks)"), {
      target: { value: "94110" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    expect(screen.getByText("What makes it a good weekend?")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Story time & books/ }));
    fireEvent.click(screen.getByRole("button", { name: "Free" }));
    fireEvent.click(screen.getByRole("button", { name: "Outdoor" }));

    fireEvent.click(screen.getByRole("button", { name: /Show me my weekend/ }));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith({
      ageBands: ["toddler", "preschool"],
      zipCode: "94110",
      interests: ["story-time"],
      budget: "free",
      setting: "outdoor",
    });
  });

  it("lets the user go back to step 1 without losing selections", () => {
    render(<OnboardingWizard onComplete={() => {}} onDismiss={() => {}} />);

    fireEvent.click(screen.getByRole("button", { name: "0–2" }));
    fireEvent.click(screen.getByRole("button", { name: /Continue/ }));
    fireEvent.click(screen.getByRole("button", { name: /Back/ }));

    expect(screen.getByText("Who's in your family?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "0–2" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("dismisses without completing", () => {
    const onDismiss = vi.fn();
    render(<OnboardingWizard onComplete={() => {}} onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole("button", { name: "Skip personalization" }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });
});
