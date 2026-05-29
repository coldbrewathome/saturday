// Install-prompt plumbing for the PWA "Add to Home Screen" banner (ADR 05 §c).
//
// The `beforeinstallprompt` event can fire before React mounts, so this module
// attaches its listener at import time (it's imported from main.tsx). It stashes
// the deferred event, tracks the gating state in localStorage, and exposes a
// tiny subscribe() so InstallBanner re-renders when the event arrives or the
// app is installed. All localStorage keys are per-origin, so famhop.com and
// nighthop.pages.dev are tracked independently.

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const VISITS_KEY = "famhop:visits";
const DISMISSED_KEY = "famhop:install:dismissedAt";
const INSTALLED_KEY = "famhop:install:installed";
const DISMISS_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;
const MIN_VISITS = 2;

let deferredPrompt: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const fn of listeners) fn();
}

function readString(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeString(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private-mode or quota errors are non-fatal; the banner just won't gate.
  }
}

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (event) => {
    // Suppress Chrome's mini-infobar; we surface our own affordance instead.
    event.preventDefault();
    deferredPrompt = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener("appinstalled", () => {
    deferredPrompt = null;
    writeString(INSTALLED_KEY, "1");
    emit();
  });
}

export function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function hasDeferredPrompt(): boolean {
  return deferredPrompt !== null;
}

/** Fire the native install prompt. Returns true if the user accepted. */
export async function triggerInstall(): Promise<boolean> {
  if (!deferredPrompt) return false;
  await deferredPrompt.prompt();
  const choice = await deferredPrompt.userChoice;
  deferredPrompt = null;
  if (choice.outcome === "accepted") writeString(INSTALLED_KEY, "1");
  emit();
  return choice.outcome === "accepted";
}

/** Count this page load as a session. Called once from main.tsx. */
export function recordVisit(): void {
  const n = Number(readString(VISITS_KEY) || "0") + 1;
  writeString(VISITS_KEY, String(n));
}

export function isIosSafari(): boolean {
  const ua = navigator.userAgent;
  const isIos = /iP(hone|ad|od)/.test(ua);
  // Exclude Chrome/Firefox/Edge on iOS — they can't Add to Home Screen.
  const isSafari = /Safari/.test(ua) && !/(CriOS|FxiOS|EdgiOS)/.test(ua);
  return isIos && isSafari;
}

export function isStandalone(): boolean {
  try {
    return (
      window.matchMedia("(display-mode: standalone)").matches ||
      // iOS Safari predates display-mode; it exposes navigator.standalone.
      (window.navigator as { standalone?: boolean }).standalone === true
    );
  } catch {
    return false;
  }
}

/** Record a "Not now" dismissal; suppresses the banner for 30 days. */
export function dismissInstall(): void {
  writeString(DISMISSED_KEY, new Date().toISOString());
}

/**
 * The ADR §(c) gates that don't depend on the deferred prompt: not already
 * installed/standalone, enough visits, and not recently dismissed. InstallBanner
 * additionally requires (hasDeferredPrompt || isIosSafari). The /ops gate is
 * satisfied structurally — InstallBanner only mounts inside the App view, which
 * never renders on /ops routes.
 */
export function isEligible(): boolean {
  if (isStandalone()) return false;
  if (readString(INSTALLED_KEY) === "1") return false;
  if (Number(readString(VISITS_KEY) || "0") < MIN_VISITS) return false;
  const dismissedAt = readString(DISMISSED_KEY);
  if (dismissedAt) {
    const ts = Date.parse(dismissedAt);
    if (!Number.isNaN(ts) && Date.now() - ts < DISMISS_WINDOW_MS) return false;
  }
  return true;
}
