import { beforeEach, afterEach, describe, expect, it } from "vitest";
import {
  isEligible,
  isIosSafari,
  recordVisit,
  dismissInstall,
} from "../src/installPrompt";

const VISITS = "famhop:visits";
const DISMISSED = "famhop:install:dismissedAt";
const INSTALLED = "famhop:install:installed";

function setUA(ua: string) {
  Object.defineProperty(window.navigator, "userAgent", {
    value: ua,
    configurable: true,
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("isEligible", () => {
  it("is false with fewer than 2 visits", () => {
    window.localStorage.setItem(VISITS, "1");
    expect(isEligible()).toBe(false);
  });

  it("is true at 2+ visits, not installed, not dismissed", () => {
    window.localStorage.setItem(VISITS, "2");
    expect(isEligible()).toBe(true);
  });

  it("is false once installed", () => {
    window.localStorage.setItem(VISITS, "5");
    window.localStorage.setItem(INSTALLED, "1");
    expect(isEligible()).toBe(false);
  });

  it("is false within the 30-day dismiss window", () => {
    window.localStorage.setItem(VISITS, "5");
    window.localStorage.setItem(DISMISSED, new Date().toISOString());
    expect(isEligible()).toBe(false);
  });

  it("is true again after the dismiss window lapses", () => {
    window.localStorage.setItem(VISITS, "5");
    const old = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000).toISOString();
    window.localStorage.setItem(DISMISSED, old);
    expect(isEligible()).toBe(true);
  });
});

describe("recordVisit", () => {
  it("increments the visit counter", () => {
    recordVisit();
    recordVisit();
    expect(window.localStorage.getItem(VISITS)).toBe("2");
  });
});

describe("dismissInstall", () => {
  it("stamps an ISO dismissedAt timestamp", () => {
    dismissInstall();
    const raw = window.localStorage.getItem(DISMISSED);
    expect(raw).toBeTruthy();
    expect(Number.isNaN(Date.parse(raw as string))).toBe(false);
  });
});

describe("isIosSafari", () => {
  it("is true for iPhone Safari", () => {
    setUA(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    );
    expect(isIosSafari()).toBe(true);
  });

  it("is false for Chrome on iOS (CriOS)", () => {
    setUA(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/120.0 Mobile/15E148 Safari/604.1",
    );
    expect(isIosSafari()).toBe(false);
  });

  it("is false for desktop Chrome", () => {
    setUA(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
    );
    expect(isIosSafari()).toBe(false);
  });
});
