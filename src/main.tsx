import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { APP_AUDIENCE } from "./appConfig";
import { metroFromPath } from "./metros";
import OpsAlertsView from "./ops/OpsAlertsView";
import OpsAnalyticsView from "./ops/OpsAnalyticsView";
import PollView from "./PollView";
import { recordVisit } from "./installPrompt";
import "./styles.css";

// Stamp the audience on the document root so audience-specific CSS variable
// overrides (e.g. a violet accent for the adults app) can hang off it.
document.documentElement.setAttribute("data-app-audience", APP_AUDIENCE);

// Count this load toward the install-banner visit gate (ADR 05 §c). The
// beforeinstallprompt listener is attached as a side effect of this import.
recordVisit();

type PollRoute = { pollId: string; embed: boolean } | null;

function readPollRouteFromHash(): PollRoute {
  const match = window.location.hash.match(/^#\/(p|embed)\/([\w-]+)(?:\?(.*))?$/);
  if (!match) return null;
  const [, route, pollId, query = ""] = match;
  const params = new URLSearchParams(query);
  return { pollId, embed: route === "embed" || params.get("embed") === "1" };
}

function isOpsAlertsHash(): boolean {
  // Accept "#/ops/alerts" and "#/ops/alerts?..." so filter state can ride in
  // a querystring inside the hash without breaking route detection.
  const hash = window.location.hash;
  return hash === "#/ops/alerts" || hash.startsWith("#/ops/alerts?");
}

function isOpsAnalyticsHash(): boolean {
  // Same shape as the alerts route — allow a future querystring for filter
  // state without breaking route detection.
  const hash = window.location.hash;
  return hash === "#/ops/analytics" || hash.startsWith("#/ops/analytics?");
}

function Root() {
  const [pollRoute, setPollRoute] = useState<PollRoute>(() =>
    readPollRouteFromHash(),
  );
  const [opsAlerts, setOpsAlerts] = useState<boolean>(() => isOpsAlertsHash());
  const [opsAnalytics, setOpsAnalytics] = useState<boolean>(() =>
    isOpsAnalyticsHash(),
  );
  const [{ metro, isAlias, canonicalPath }] = useState(() =>
    metroFromPath(window.location.pathname),
  );

  useEffect(() => {
    if (!isAlias) return;
    window.history.replaceState(
      null,
      "",
      `${canonicalPath}${window.location.search}${window.location.hash}`,
    );
  }, [canonicalPath, isAlias]);

  useEffect(() => {
    function handler() {
      setPollRoute(readPollRouteFromHash());
      setOpsAlerts(isOpsAlertsHash());
      setOpsAnalytics(isOpsAnalyticsHash());
    }
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  if (pollRoute) {
    return <PollView pollId={pollRoute.pollId} embed={pollRoute.embed} />;
  }
  if (opsAlerts) {
    return <OpsAlertsView />;
  }
  if (opsAnalytics) {
    return <OpsAnalyticsView />;
  }
  return <App metro={metro} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

// Register the service worker only in production builds. Dev gets no SW so
// HMR isn't disrupted by cached chunks. Caching strategies land in a follow-up
// task per ADR 05; this scaffold ships the autoUpdate registration only.
if (import.meta.env.PROD) {
  import("virtual:pwa-register")
    .then(({ registerSW }) => {
      registerSW({ immediate: true });
    })
    .catch(() => {
      // SW registration is best-effort; failures here shouldn't break the app.
    });
}
