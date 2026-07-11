#!/usr/bin/env node
// Zero-dependency YouTube uploader for the FamHop intro.
//
// Uploads video/famhop-intro-youtube-final.mp4 to YouTube via the Data API v3
// with the title/description/tags from video/youtube-metadata.md, then sets a
// thumbnail. OAuth runs through a local loopback (no secrets leave your machine).
//
// ── One-time setup (≈5 min) ────────────────────────────────────────────────
//   1. https://console.cloud.google.com → create/select a project.
//   2. APIs & Services → Library → enable "YouTube Data API v3".
//   3. APIs & Services → OAuth consent screen → User type "External" →
//      fill app name/email → on "Test users" add YOUR Google account
//      (the one that owns the channel). Save. (No verification needed for
//      test users.)
//   4. APIs & Services → Credentials → Create credentials → OAuth client ID →
//      Application type "Desktop app" → Create → Download JSON.
//   5. Save that file as  video/youtube-oauth.json  (already gitignored).
//
// ── Run ─────────────────────────────────────────────────────────────────────
//   node video/upload-youtube.mjs                 # uploads as PRIVATE (default)
//   node video/upload-youtube.mjs --privacy public
//   node video/upload-youtube.mjs --privacy unlisted
//
// First run opens a browser to grant access; the token is cached in
// video/.youtube-token.json so later runs are non-interactive.
//
// After upload, copy the printed video ID into public/intro.html
// (replace REPLACE_WITH_VIDEO_ID, two spots) and run `npm run deploy:kids`.

import { readFile, writeFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const OAUTH_FILE = join(HERE, "youtube-oauth.json");
const TOKEN_FILE = join(HERE, ".youtube-token.json");
const VIDEO_FILE = join(HERE, "famhop-intro-youtube-final.mp4");
const THUMB_FILE = join(HERE, "..", "public", "og-image.png");
const SCOPE = "https://www.googleapis.com/auth/youtube.upload";
const LOOPBACK_PORT = 4787;

// ── Video metadata (keep in sync with video/youtube-metadata.md) ─────────────
const PRIVACY = (argFlag("--privacy") || "private").toLowerCase();
const SNIPPET = {
  title: "FamHop — Plan Your Weekend With the Kids in 30 Seconds",
  description: [
    "Stop guessing what to do this weekend. FamHop finds parks, libraries, museums, and real family events near you — then maps them into a ready-made plan you can share and vote on. Free across 16 U.S. metros.",
    "",
    "▶ Try it free: https://famhop.com",
    "",
    "What FamHop does:",
    "• Your whole weekend (Fri–Sun) in one place — parks, libraries, museums, real family events",
    "• Hop Now — instant picks for something to do right now",
    "• Start from a ready-made plan or build your own; we map it into a route for the day",
    "• Filter by your kids' ages, interests, and distance so every stop fits",
    "• Share the plan and let everyone vote",
    "",
    "Free across 16 U.S. metros: Atlanta, Austin, Bay Area, Boston, Chicago, Dallas–Fort Worth, Honolulu, Houston, Los Angeles, Miami, New York City, Philadelphia, Phoenix, San Diego, Seattle, and Washington, D.C.",
    "",
    "#familyactivities #thingstodowithkids #weekendplans",
  ].join("\n"),
  tags: [
    "family activities", "things to do with kids", "weekend plans",
    "family events near me", "kids activities", "weekend with kids",
    "family outings", "FamHop", "parenting", "family travel",
  ],
  categoryId: "26", // Howto & Style
  defaultLanguage: "en",
  defaultAudioLanguage: "en",
};

function argFlag(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}

async function readJson(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

function clientConfig(raw) {
  const c = raw.installed || raw.web || raw;
  if (!c.client_id || !c.client_secret) {
    throw new Error("youtube-oauth.json is missing client_id/client_secret — re-download the Desktop OAuth client.");
  }
  return { id: c.client_id, secret: c.client_secret };
}

function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open"
    : process.platform === "win32" ? "start" : "xdg-open";
  spawn(cmd, [url], { stdio: "ignore", detached: true, shell: process.platform === "win32" }).unref();
}

// Run the loopback consent flow and return a fresh token bundle.
async function consent(client) {
  const redirect = `http://localhost:${LOOPBACK_PORT}`;
  const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: client.id,
    redirect_uri: redirect,
    response_type: "code",
    scope: SCOPE,
    access_type: "offline",
    prompt: "consent",
  });

  const code = await new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      const u = new URL(req.url, redirect);
      const c = u.searchParams.get("code");
      const err = u.searchParams.get("error");
      res.writeHead(200, { "Content-Type": "text/html" });
      res.end(`<html><body style="font-family:system-ui;text-align:center;padding-top:80px">
        <h2>${c ? "✅ FamHop uploader authorized" : "❌ Authorization failed"}</h2>
        <p>You can close this tab and return to the terminal.</p></body></html>`);
      server.close();
      if (c) resolve(c); else reject(new Error("OAuth error: " + (err || "no code")));
    });
    server.listen(LOOPBACK_PORT, () => {
      console.log("\nOpening browser for Google sign-in…");
      console.log("If it doesn't open, paste this URL:\n" + authUrl + "\n");
      openBrowser(authUrl);
    });
  });

  const token = await exchange(client, {
    grant_type: "authorization_code",
    code,
    redirect_uri: redirect,
  });
  return token;
}

async function exchange(client, params) {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: client.id, client_secret: client.secret, ...params }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error("Token exchange failed: " + JSON.stringify(body));
  return body;
}

// Return a valid access token, refreshing or running consent as needed.
async function getAccessToken(client) {
  let token = null;
  try { token = await readJson(TOKEN_FILE); } catch { /* none yet */ }

  if (token?.access_token && token.expiry && Date.now() < token.expiry - 60_000) {
    return token.access_token;
  }
  if (token?.refresh_token) {
    const refreshed = await exchange(client, { grant_type: "refresh_token", refresh_token: token.refresh_token });
    token = { ...token, ...refreshed, expiry: Date.now() + refreshed.expires_in * 1000 };
    await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
    return token.access_token;
  }
  const fresh = await consent(client);
  token = { ...fresh, expiry: Date.now() + fresh.expires_in * 1000 };
  await writeFile(TOKEN_FILE, JSON.stringify(token, null, 2));
  return token.access_token;
}

async function uploadVideo(accessToken) {
  const bytes = await readFile(VIDEO_FILE);
  const meta = { snippet: SNIPPET, status: { privacyStatus: PRIVACY, selfDeclaredMadeForKids: false } };

  // 1) start a resumable session
  const init = await fetch(
    "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json; charset=UTF-8",
        "X-Upload-Content-Type": "video/mp4",
        "X-Upload-Content-Length": String(bytes.length),
      },
      body: JSON.stringify(meta),
    },
  );
  if (!init.ok) throw new Error("Upload init failed: " + (await init.text()));
  const location = init.headers.get("location");
  if (!location) throw new Error("No resumable upload URL returned.");

  // 2) send the bytes (single PUT — the file is small)
  console.log(`Uploading ${(bytes.length / 1e6).toFixed(1)} MB…`);
  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) },
    body: bytes,
  });
  const result = await put.json();
  if (!put.ok) throw new Error("Upload failed: " + JSON.stringify(result));
  return result.id;
}

async function setThumbnail(accessToken, videoId) {
  let img;
  try { img = await readFile(THUMB_FILE); } catch { return false; }
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/png" }, body: img },
  );
  return res.ok;
}

async function main() {
  if (!["public", "unlisted", "private"].includes(PRIVACY)) {
    throw new Error(`--privacy must be public|unlisted|private (got "${PRIVACY}")`);
  }
  let raw;
  try { raw = await readJson(OAUTH_FILE); }
  catch { throw new Error(`Missing ${OAUTH_FILE}. See the setup steps at the top of this file.`); }
  await stat(VIDEO_FILE); // fail early if the MP4 is missing

  const client = clientConfig(raw);
  const accessToken = await getAccessToken(client);

  console.log(`\nUploading "${SNIPPET.title}" as ${PRIVACY.toUpperCase()}…`);
  const videoId = await uploadVideo(accessToken);
  const thumbOk = await setThumbnail(accessToken, videoId);

  console.log("\n✅ Uploaded.");
  console.log("   Watch:  https://youtu.be/" + videoId);
  console.log("   Studio: https://studio.youtube.com/video/" + videoId + "/edit");
  console.log("   Thumbnail: " + (thumbOk ? "set (og-image.png)" : "skipped — set manually in Studio"));
  console.log("\nNext:");
  console.log("   1. Replace REPLACE_WITH_VIDEO_ID (×2) in public/intro.html with: " + videoId);
  if (PRIVACY !== "public") console.log("   2. Flip visibility to Public in Studio when ready.");
  console.log("   " + (PRIVACY !== "public" ? "3" : "2") + ". npm run deploy:kids");
}

main().catch((e) => { console.error("\n❌ " + e.message); process.exit(1); });
