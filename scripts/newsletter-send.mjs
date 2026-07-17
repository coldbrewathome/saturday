#!/usr/bin/env node
// Operator CLI for the weekly newsletter send. Builds the recipients
// payload that POST /newsletter/send expects — nothing in the worker
// itself lists KV subscribers, so this is the missing link between
// "operator sets secrets" and "first real send" (see docs/launch/HUMAN-OPS.md).
//
//   node scripts/newsletter-send.mjs                  # dry-run: list KV subscribers, print payload + count, send nothing
//   node scripts/newsletter-send.mjs --from-json f.json  # dry-run against a local recipients dump instead of live KV
//   node scripts/newsletter-send.mjs --send           # POST the payload to the worker (requires NEWSLETTER_ADMIN_TOKEN env)
//
// Recipients live in the POLLS KV namespace as `newsletter:{metroId}:{email}`
// keys (see worker/src/index.ts subscribeNewsletter) — the metroId and email
// are recovered from the key name itself (both are encodeURIComponent'd, no
// KV read needed). --send still goes through the worker's own
// NEWSLETTER_ENABLED / RESEND_API_KEY / NEWSLETTER_TEST_ALLOWLIST gates —
// this script only assembles who to send to, it doesn't bypass them.

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WORKER_DIR = path.join(ROOT, "worker");

// worker/wrangler.toml [[kv_namespaces]] binding = "POLLS".
const POLLS_NAMESPACE_ID = "dd49dd61e74b4823b9427a91df59eb3e";
const DEFAULT_WORKER_URL = "https://saturday-polls.santaclararental2016.workers.dev";

const args = process.argv.slice(2);
const send = args.includes("--send");
const fromJsonFlagIndex = args.indexOf("--from-json");
const fromJsonPath = fromJsonFlagIndex >= 0 ? args[fromJsonFlagIndex + 1] : undefined;
const workerUrlFlagIndex = args.indexOf("--worker-url");
const workerUrl = (
  (workerUrlFlagIndex >= 0 && args[workerUrlFlagIndex + 1]) ||
  process.env.NEWSLETTER_WORKER_URL ||
  DEFAULT_WORKER_URL
).replace(/\/$/, "");

function recipientsFromKvKeyNames(names) {
  const recipients = [];
  const seen = new Set();
  for (const name of names) {
    // newsletter:{metroId}:{email}, both segments encodeURIComponent'd —
    // split on the first two colons only (the encoded segments never
    // contain a literal ":").
    const match = /^newsletter:([^:]*):([^:]*)$/.exec(name);
    if (!match) continue;
    const metroId = decodeURIComponent(match[1]);
    const email = decodeURIComponent(match[2]);
    const key = `${metroId}:${email}`;
    if (seen.has(key)) continue;
    seen.add(key);
    recipients.push({ email, metroId });
  }
  return recipients;
}

function listKvSubscribers() {
  const raw = execFileSync(
    "npx",
    [
      "wrangler",
      "kv",
      "key",
      "list",
      `--namespace-id=${POLLS_NAMESPACE_ID}`,
      "--prefix=newsletter:",
    ],
    { cwd: WORKER_DIR, encoding: "utf8" },
  );
  const keys = JSON.parse(raw);
  return recipientsFromKvKeyNames(keys.map((k) => k.name));
}

function loadFromJson(filePath) {
  const doc = JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
  const list = Array.isArray(doc) ? doc : doc.recipients;
  if (!Array.isArray(list)) {
    throw new Error(
      `${filePath}: expected a JSON array or { recipients: [...] }`,
    );
  }
  return list.map((r) => ({
    email: String(r.email || ""),
    metroId: r.metroId ? String(r.metroId) : undefined,
    ageBand: r.ageBand ? String(r.ageBand) : undefined,
  }));
}

const recipients = fromJsonPath ? loadFromJson(fromJsonPath) : listKvSubscribers();

const byMetro = {};
for (const r of recipients) {
  const metro = r.metroId || "(missing)";
  byMetro[metro] = (byMetro[metro] || 0) + 1;
}

console.log(
  `${recipients.length} recipient(s) from ${fromJsonPath ? fromJsonPath : "KV (newsletter: prefix)"}`,
);
for (const [metro, count] of Object.entries(byMetro).sort()) {
  console.log(`  ${metro}: ${count}`);
}

if (!send) {
  console.log("\n--dry-run (default) — payload below, nothing sent:\n");
  console.log(JSON.stringify({ recipients }, null, 2));
  process.exit(0);
}

const token = process.env.NEWSLETTER_ADMIN_TOKEN;
if (!token) {
  console.error(
    "\n--send requires the NEWSLETTER_ADMIN_TOKEN env var (the same bearer token set via `wrangler secret put NEWSLETTER_ADMIN_TOKEN`).",
  );
  process.exit(1);
}

if (recipients.length === 0) {
  console.error("\nno recipients to send to — exiting without a request.");
  process.exit(1);
}

console.log(`\nPOST ${workerUrl}/newsletter/send (${recipients.length} recipient(s))...`);
const res = await fetch(`${workerUrl}/newsletter/send`, {
  method: "POST",
  headers: {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  },
  body: JSON.stringify({ recipients }),
});
const body = await res.text();
console.log(`status ${res.status}`);
console.log(body);
if (!res.ok) process.exit(1);
