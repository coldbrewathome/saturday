#!/usr/bin/env node
// Zero-dependency YouTube uploader for the weekly FamHop metro Shorts.
//
// Uploads the delivery mp4s for one weekend to YouTube via the Data API v3,
// with title/description/tags from the upload-manifest.json that
// build-shorts-metadata.mjs emits (so metadata can never drift from the
// video). Optionally adds each upload to a playlist.
//
// OAuth is shared with video/upload-youtube.mjs — the SAME one-time setup
// covers both (see the setup steps in that file's header):
//   video/youtube-oauth.json  — Desktop OAuth client (gitignored)
//   video/.youtube-token.json — cached token, written on first consent
//
// ── Run ─────────────────────────────────────────────────────────────────────
//   node videos/upload-shorts.mjs                       # latest week, PRIVATE
//   node videos/upload-shorts.mjs --week 2026-08-08 --privacy public
//   node videos/upload-shorts.mjs --metro bay-area      # one metro only
//   node videos/upload-shorts.mjs --playlist "This Weekend With Kids"
//   node videos/upload-shorts.mjs --thumb /tmp/short-thumb.jpg  # same thumb for all
//   node videos/upload-shorts.mjs --manifest videos/delivery-guides/upload-manifest.json
//                                  --id <guide-id>      # evergreen guides batch
//   (guides get per-entry thumbnails from the manifest; --thumb overrides)
//
// Default privacy is private — flip to public in Studio, or re-run with
// --privacy public (idempotent-ish: it uploads fresh copies, so prefer the
// Studio flip once the batch is verified).
//
// First run opens a browser to grant access; later runs are non-interactive.

import { readFile, writeFile, stat } from "node:fs/promises";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const OAUTH_FILE = join(ROOT, "video", "youtube-oauth.json");
const TOKEN_FILE = join(ROOT, "video", ".youtube-token.json");
const SCOPE = "https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube";
const LOOPBACK_PORT = 4787;

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

async function uploadVideo(accessToken, filePath, snippet, privacyStatus) {
  const bytes = await readFile(filePath);
  const meta = {
    snippet: { ...snippet, categoryId: snippet.categoryId || "22" },
    status: { privacyStatus, selfDeclaredMadeForKids: false },
  };

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

  console.log(`Uploading ${(bytes.length / 1e6).toFixed(1)} MB — "${snippet.title}"`);
  const put = await fetch(location, {
    method: "PUT",
    headers: { "Content-Type": "video/mp4", "Content-Length": String(bytes.length) },
    body: bytes,
  });
  const result = await put.json();
  if (!put.ok) throw new Error("Upload failed: " + JSON.stringify(result));
  return result.id;
}

async function setThumbnail(accessToken, videoId, thumbFile) {
  if (!thumbFile) return false;
  const img = await readFile(thumbFile);
  const res = await fetch(
    `https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId=${videoId}`,
    { method: "POST", headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "image/png" }, body: img },
  );
  return res.ok;
}

// Resolve a playlist title owned by the channel to its id, or null.
async function findPlaylist(accessToken, name) {
  const res = await fetch(
    "https://www.googleapis.com/youtube/v3/playlists?part=snippet&mine=true&maxResults=50",
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  const body = await res.json();
  if (!res.ok) throw new Error("Playlist lookup failed: " + JSON.stringify(body));
  const hit = body.items?.find((p) => p.snippet?.title === name);
  return hit?.id || null;
}

async function addToPlaylist(accessToken, playlistId, videoId) {
  const res = await fetch("https://www.googleapis.com/youtube/v3/playlistItems?part=snippet", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }),
  });
  if (!res.ok) throw new Error("Playlist add failed: " + JSON.stringify(await res.text()));
}

async function main() {
  const privacy = (argFlag("--privacy") || "private").toLowerCase();
  if (!["public", "unlisted", "private"].includes(privacy)) {
    throw new Error(`--privacy must be public|unlisted|private (got "${privacy}")`);
  }
  const idOnly = argFlag("--id") || argFlag("--metro");
  const playlistName = argFlag("--playlist");

  // Locate the manifest: --manifest <path>, or --week <saturday> / the latest
  // week from weekend-picks.json.
  const manifestPath = argFlag("--manifest");
  const picks = manifestPath ? null : await readJson(join(HERE, "weekend-picks.json"));
  const week = argFlag("--week") || picks?.weekend.saturday || "guides";
  const manifest = await readJson(manifestPath ? join(ROOT, manifestPath) : join(HERE, `shorts-${week}`, "upload-manifest.json"));
  const shorts = idOnly
    ? (manifest.guides || manifest.shorts).filter((s) => s.id === idOnly)
    : (manifest.guides || manifest.shorts);
  if (!shorts.length) throw new Error(`No videos found in ${manifestPath || `shorts-${week}/upload-manifest.json`}${idOnly ? ` (id ${idOnly})` : ""}.`);

  const client = clientConfig(await readJson(OAUTH_FILE));
  const accessToken = await getAccessToken(client);

  let playlistId = null;
  if (playlistName) {
    playlistId = await findPlaylist(accessToken, playlistName);
    if (!playlistId) {
      console.log(`⚠ Playlist "${playlistName}" not found — uploads will not be added to a playlist.`);
    }
  }

  const shared = manifest.shared || {};
  const thumbFile = argFlag("--thumb");
  const uploaded = [];
  for (const s of shorts) {
    const thumb = thumbFile || s.thumb; // guides carry their own thumbnails
    const filePath = join(ROOT, s.file);
    await stat(filePath); // fail early if the mp4 is missing
    const snippet = {
      title: s.title,
      description: s.description,
      tags: s.tags,
      categoryId: shared.categoryId,
      defaultLanguage: shared.defaultLanguage,
      defaultAudioLanguage: shared.defaultAudioLanguage,
    };
    const videoId = await uploadVideo(accessToken, filePath, snippet, privacy);
    const thumbOk = await setThumbnail(accessToken, videoId, thumb);
    if (playlistId) await addToPlaylist(accessToken, playlistId, videoId);
    uploaded.push({ id: s.id, videoId, title: s.title });
    console.log(`   ✅ https://youtu.be/${videoId}${thumbOk ? " (thumb set)" : ""}`);
    // Space uploads out slightly — YouTube rate-limits rapid-fire bursts.
    await new Promise((r) => setTimeout(r, 1500));
  }

  console.log(`\n✅ Uploaded ${uploaded.length} videos (week ${week}, ${privacy.toUpperCase()}).`);
  for (const u of uploaded) console.log(`   ${u.id}: https://studio.youtube.com/video/${u.videoId}/edit`);
  if (privacy !== "public") console.log("\nFlip visibility to Public in Studio when verified — don't re-run with --privacy public (that would duplicate).");
}

main().catch((e) => { console.error("\n❌ " + e.message); process.exit(1); });
