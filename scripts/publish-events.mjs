#!/usr/bin/env node
/**
 * Publish events.json to the worker /admin/events endpoint.
 *
 * Auth: copy your session token from the browser after signing in.
 *   In devtools console on the live site:
 *     JSON.parse(localStorage.getItem("saturday.session")).token
 *
 * Then run:
 *   SATURDAY_SESSION_TOKEN=<token> \
 *   SATURDAY_API=https://saturday-polls.santaclararental2016.workers.dev \
 *   node scripts/publish-events.mjs --metro=los-angeles [path/to/events.json]
 *
 * The default file is public/data/events.json. Replace with --reset to
 * clear the KV override and revert to the static file:
 *   ... node scripts/publish-events.mjs --reset
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const token = process.env.SATURDAY_SESSION_TOKEN;
const api = (process.env.SATURDAY_API || "").replace(/\/$/, "");

if (!token) {
  console.error("Missing SATURDAY_SESSION_TOKEN env var.");
  process.exit(1);
}
if (!api) {
  console.error("Missing SATURDAY_API env var (worker base URL).");
  process.exit(1);
}

const args = process.argv.slice(2);
const reset = args.includes("--reset");
const metroArg = args.find((arg) => arg.startsWith("--metro="));
const metro = metroArg ? metroArg.slice("--metro=".length) : "bay-area";
const filePath =
  args.find((arg) => !arg.startsWith("--")) ??
  (metro === "bay-area"
    ? path.join("public", "data", "events.json")
    : path.join("public", "data", metro, "events.json"));
const endpoint = `${api}/admin/events?metro=${encodeURIComponent(metro)}`;

if (reset) {
  const response = await fetch(endpoint, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });
  console.log(`reset → HTTP ${response.status}`);
  console.log(await response.text());
  process.exit(response.ok ? 0 : 1);
}

const raw = readFileSync(filePath, "utf8");
const parsed = JSON.parse(raw);
if (!Array.isArray(parsed.events)) {
  console.error(`No 'events' array found in ${filePath}`);
  process.exit(1);
}

const response = await fetch(endpoint, {
  method: "PUT",
  headers: {
    "content-type": "application/json",
    authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ events: parsed.events }),
});

const detail = await response.text();
console.log(`PUT ${endpoint} -> HTTP ${response.status}`);
console.log(detail);
process.exit(response.ok ? 0 : 1);
