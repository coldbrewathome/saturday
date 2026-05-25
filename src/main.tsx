import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { APP_AUDIENCE } from "./appConfig";
import { metroFromPath } from "./metros";
import OpsAlertsView from "./ops/OpsAlertsView";
import PollView from "./PollView";
import "./styles.css";

// Stamp the audience on the document root so audience-specific CSS variable
// overrides (e.g. a violet accent for the adults app) can hang off it.
document.documentElement.setAttribute("data-app-audience", APP_AUDIENCE);

type PollRoute = { pollId: string; embed: boolean } | null;

function readPollRouteFromHash(): PollRoute {
  const match = window.location.hash.match(/^#\/(p|embed)\/([\w-]+)(?:\?(.*))?$/);
  if (!match) return null;
  const [, route, pollId, query = ""] = match;
  const params = new URLSearchParams(query);
  return { pollId, embed: route === "embed" || params.get("embed") === "1" };
}

function isOpsAlertsHash(): boolean {
  return window.location.hash === "#/ops/alerts";
}

function Root() {
  const [pollRoute, setPollRoute] = useState<PollRoute>(() =>
    readPollRouteFromHash(),
  );
  const [opsAlerts, setOpsAlerts] = useState<boolean>(() => isOpsAlertsHash());
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
  return <App metro={metro} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
