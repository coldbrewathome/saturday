import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import PollView from "./PollView";
import "./styles.css";

function readPollIdFromHash(): string | null {
  const match = window.location.hash.match(/^#\/p\/([\w-]+)$/);
  return match ? match[1] : null;
}

function Root() {
  const [pollId, setPollId] = useState<string | null>(() => readPollIdFromHash());

  useEffect(() => {
    function handler() {
      setPollId(readPollIdFromHash());
    }
    window.addEventListener("hashchange", handler);
    return () => window.removeEventListener("hashchange", handler);
  }, []);

  return pollId ? <PollView pollId={pollId} /> : <App />;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
