import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import InstallBanner from "../src/InstallBanner";

function setUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

const IOS_SAFARI =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

function fireBeforeInstallPrompt() {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: string }>;
  };
  event.prompt = async () => {};
  event.userChoice = Promise.resolve({ outcome: "dismissed" });
  window.dispatchEvent(event);
}

beforeEach(() => {
  window.localStorage.clear();
  setUA(DESKTOP);
});

afterEach(() => {
  cleanup();
  window.localStorage.clear();
});

describe("InstallBanner", () => {
  it("renders nothing when not eligible (too few visits)", () => {
    window.localStorage.setItem("famhop:visits", "1");
    setUA(IOS_SAFARI);
    const { container } = render(<InstallBanner />);
    expect(container).toBeEmptyDOMElement();
  });

  it("shows an iOS 'Show me how' affordance when eligible on iOS Safari", () => {
    window.localStorage.setItem("famhop:visits", "2");
    setUA(IOS_SAFARI);
    render(<InstallBanner />);
    expect(screen.getByText(/add .* to your home screen/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /show me how/i })).toBeInTheDocument();
  });

  it("opens the Add-to-Home-Screen tutorial on iOS when tapped", () => {
    window.localStorage.setItem("famhop:visits", "2");
    setUA(IOS_SAFARI);
    render(<InstallBanner />);
    fireEvent.click(screen.getByRole("button", { name: /show me how/i }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/add to home screen/i)).toBeInTheDocument();
  });

  it("'Not now' dismisses the banner and persists a 30-day dismissal", () => {
    window.localStorage.setItem("famhop:visits", "2");
    fireBeforeInstallPrompt(); // non-iOS path needs a deferred prompt
    render(<InstallBanner />);
    expect(screen.getByRole("button", { name: /install/i })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /not now/i }));
    expect(screen.queryByRole("button", { name: /install/i })).not.toBeInTheDocument();
    expect(window.localStorage.getItem("famhop:install:dismissedAt")).toBeTruthy();
  });
});
