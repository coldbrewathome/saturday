import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { APP_AUDIENCE } from "./appConfig";
import { metroFromPath } from "./metros";
import PollView from "./PollView";
import "./styles.css";

// Stamp the audience on the document root so audience-specific CSS variable
// overrides (e.g. a violet accent for the adults app) can hang off it.
document.documentElement.setAttribute("data-app-audience", APP_AUDIENCE);

function readPollIdFromHash(): string | null {
  const match = window.location.hash.match(/^#\/p\/([\w-]+)$/);
  return match ? match[1] : null;
}

function Root() {
  const [pollId, setPollId] = useState<string | null>(() => readPollIdFromHash());
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
      setPollId(readPollIdFromHash());
    }
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return pollId ? <PollView pollId={pollId} /> : <App metro={metro} />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
