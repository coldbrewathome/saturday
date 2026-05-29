import { useEffect, useState } from "react";
import { APP_BRAND } from "./appConfig";
import {
  dismissInstall,
  hasDeferredPrompt,
  isEligible,
  isIosSafari,
  subscribe,
  triggerInstall,
} from "./installPrompt";

// "Add to Home Screen" banner. Mounted from App (so it never shows on /ops).
// Android/desktop fire `beforeinstallprompt`, so tapping Install triggers the
// native prompt. iOS Safari can't, so it opens a Share → Add to Home Screen
// tutorial instead. Gating lives in installPrompt.ts (ADR 05 §c).
export default function InstallBanner() {
  const [promptReady, setPromptReady] = useState(() => hasDeferredPrompt());
  const [dismissed, setDismissed] = useState(false);
  const [showIosHelp, setShowIosHelp] = useState(false);

  useEffect(() => subscribe(() => setPromptReady(hasDeferredPrompt())), []);

  const ios = isIosSafari();
  if (dismissed || !isEligible() || (!promptReady && !ios)) return null;

  function handleDismiss() {
    dismissInstall();
    setDismissed(true);
  }

  async function handleInstall() {
    if (ios) {
      setShowIosHelp(true);
      return;
    }
    const accepted = await triggerInstall();
    // If accepted, hide for this session; appinstalled also persists it. If the
    // user dismissed the native prompt, leave the banner so they can retry.
    if (accepted) setDismissed(true);
  }

  return (
    <>
      <div
        className="install-banner"
        role="region"
        aria-label={`Install ${APP_BRAND}`}
      >
        <div className="install-banner-body">
          <span className="install-banner-text">
            Add {APP_BRAND} to your home screen for one-tap weekend planning.
          </span>
          <div className="install-banner-actions">
            <button
              type="button"
              className="install-banner-cta"
              onClick={handleInstall}
            >
              {ios ? "Show me how" : "Install"}
            </button>
            <button
              type="button"
              className="install-banner-dismiss"
              onClick={handleDismiss}
            >
              Not now
            </button>
          </div>
        </div>
      </div>

      {showIosHelp && (
        <div
          className="modal-backdrop install-help-backdrop"
          role="presentation"
          onClick={() => setShowIosHelp(false)}
        >
          <div
            className="install-help-card"
            role="dialog"
            aria-modal="true"
            aria-labelledby="install-help-title"
            onClick={(event) => event.stopPropagation()}
          >
            <button
              type="button"
              className="install-help-close"
              title="Close"
              aria-label="Close"
              onClick={() => setShowIosHelp(false)}
            >
              ×
            </button>
            <h2 id="install-help-title">Add {APP_BRAND} to your Home Screen</h2>
            <ol className="install-help-steps">
              <li>
                Tap the <strong>Share</strong> button in Safari&rsquo;s toolbar.
              </li>
              <li>
                Scroll down and tap <strong>Add to Home Screen</strong>.
              </li>
              <li>
                Tap <strong>Add</strong> — {APP_BRAND} opens like an app.
              </li>
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
