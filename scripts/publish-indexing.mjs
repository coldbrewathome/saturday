#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const SITEMAP_PATH = path.join(ROOT, "dist", "sitemap.xml");
const SCOPE = "https://www.googleapis.com/auth/indexing";

// Helper to get local date string YYYY-MM-DD
function getTodayStr() {
  return new Date().toISOString().slice(0, 10);
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

// RS256 signing helper for Google Service Account JWT
function signJwt(serviceAccount, scope) {
  const header = {
    alg: "RS256",
    typ: "JWT",
  };
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: serviceAccount.client_email,
    sub: serviceAccount.client_email,
    aud: "https://oauth2.googleapis.com/token",
    scope: scope,
    iat: now,
    exp: now + 3600,
  };

  const base64Header = Buffer.from(JSON.stringify(header)).toString("base64url");
  const base64Payload = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signatureInput = `${base64Header}.${base64Payload}`;

  const signer = crypto.createSign("RSA-SHA256");
  signer.update(signatureInput);
  const signature = signer.sign(serviceAccount.private_key, "base64url");

  return `${signatureInput}.${signature}`;
}

async function getAccessTokenFromServiceAccount(serviceAccount, scope) {
  console.log("Authenticating via Google Service Account...");
  const jwt = signJwt(serviceAccount, scope);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Google token exchange failed: ${res.statusText}\n${text}`);
  }

  const data = await res.json();
  return data.access_token;
}

async function getAccessTokenFromAdc() {
  console.log("Authenticating via Application Default Credentials (ADC)...");
  const adcPath = path.join(os.homedir(), ".config", "gcloud", "application_default_credentials.json");
  if (!fs.existsSync(adcPath)) {
    throw new Error(`ADC file not found at ${adcPath}.\nPlease run: gcloud auth application-default login`);
  }

  const adc = JSON.parse(fs.readFileSync(adcPath, "utf8"));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: adc.client_id,
      client_secret: adc.client_secret,
      refresh_token: adc.refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ADC token exchange failed: ${res.statusText}\n${text}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    quotaProjectId: adc.quota_project_id,
  };
}

async function getAccessToken() {
  const envProject = process.env.GOOGLE_INDEXING_PROJECT_ID || process.env.GOOGLE_CLOUD_PROJECT || process.env.CLOUD_SDK_PROJECT;

  // 1. Check for Service Account Key Env
  if (process.env.GOOGLE_INDEXING_CREDENTIALS) {
    try {
      const sa = JSON.parse(process.env.GOOGLE_INDEXING_CREDENTIALS);
      const token = await getAccessTokenFromServiceAccount(sa, SCOPE);
      return { accessToken: token, quotaProjectId: envProject || null };
    } catch (e) {
      console.warn("Failed to parse GOOGLE_INDEXING_CREDENTIALS environment variable, trying ADC:", e.message);
    }
  }

  // 2. Check for Service Account file path in environment
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS && fs.existsSync(process.env.GOOGLE_APPLICATION_CREDENTIALS)) {
    try {
      const sa = JSON.parse(fs.readFileSync(process.env.GOOGLE_APPLICATION_CREDENTIALS, "utf8"));
      const token = await getAccessTokenFromServiceAccount(sa, SCOPE);
      return { accessToken: token, quotaProjectId: envProject || null };
    } catch (e) {
      console.warn("Failed to read GOOGLE_APPLICATION_CREDENTIALS file, trying ADC:", e.message);
    }
  }

  // 3. Fallback to ADC (local gcloud)
  const adcCreds = await getAccessTokenFromAdc();
  return {
    accessToken: adcCreds.accessToken,
    quotaProjectId: envProject || adcCreds.quotaProjectId,
  };
}

async function publishUrl(url, accessToken, quotaProjectId) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${accessToken}`,
  };
  if (quotaProjectId) {
    headers["X-Goog-User-Project"] = quotaProjectId;
  }
  const res = await fetch("https://indexing.googleapis.com/v3/urlNotifications:publish", {
    method: "POST",
    headers,
    body: JSON.stringify({
      url: url,
      type: "URL_UPDATED",
    }),
  });

  const text = await res.text();
  return {
    ok: res.ok,
    status: res.status,
    statusText: res.statusText,
    data: text,
  };
}

const HISTORY_PATH = path.join(ROOT, "data", "indexing-history.json");

async function main() {
  console.log("Starting Google Indexing API submission with Rolling Queue...");

  if (!fs.existsSync(SITEMAP_PATH)) {
    console.error(`✗ Error: sitemap.xml not found at ${SITEMAP_PATH}. Run 'npm run build' first.`);
    process.exit(1);
  }

  let credentials;
  try {
    credentials = await getAccessToken();
  } catch (e) {
    console.error("✗ Authentication failed:", e.message);
    console.error("\nIf running locally, please authenticate with the indexing scope by running:");
    console.error("  gcloud auth application-default login --scopes=https://www.googleapis.com/auth/indexing,https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,openid\n");
    process.exit(1);
  }

  // Load indexing history
  let history = {};
  if (fs.existsSync(HISTORY_PATH)) {
    try {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
      console.log(`Loaded indexing history with ${Object.keys(history).length} URLs.`);
    } catch (e) {
      console.warn("Failed to parse indexing history file, starting fresh:", e.message);
    }
  }

  console.log("Reading and parsing sitemap.xml...");
  const xml = fs.readFileSync(SITEMAP_PATH, "utf8");
  
  const todayStr = getTodayStr();
  const yesterdayStr = getYesterdayStr();
  console.log(`Filtering for hub pages and pages modified today (${todayStr}) or yesterday (${yesterdayStr})...`);

  const urls = [];
  const urlRegex = /<url>([\s\S]*?)<\/url>/gi;
  let match;

  while ((match = urlRegex.exec(xml)) !== null) {
    const block = match[1];
    const locMatch = block.match(/<loc>([\s\S]*?)<\/loc>/i);
    const lastmodMatch = block.match(/<lastmod>([\s\S]*?)<\/lastmod>/i);

    if (locMatch) {
      const loc = locMatch[1].trim();
      const lastmod = lastmodMatch ? lastmodMatch[1].trim() : "";
      
      const isHub = loc === "https://famhop.com/" || 
                    loc.endsWith("/this-weekend/") ||
                    /this-weekend\/?$/i.test(loc);
                    
      const isNew = lastmod === todayStr || lastmod === yesterdayStr;

      if (isHub || isNew) {
        urls.push({ loc, lastmod, isHub });
      }
    }
  }

  console.log(`Found ${urls.length} candidate URLs in sitemap.`);

  // Sort candidate URLs:
  // 1. Hubs first (highest priority)
  // 2. Non-hubs with no history (never submitted)
  // 3. Non-hubs with oldest submission date first (rolling queue)
  urls.sort((a, b) => {
    if (a.isHub && !b.isHub) return -1;
    if (!a.isHub && b.isHub) return 1;

    const aHist = history[a.loc] || "";
    const bHist = history[b.loc] || "";

    if (!aHist && bHist) return -1;
    if (aHist && !bHist) return 1;

    if (aHist && bHist) {
      return aHist.localeCompare(bHist);
    }

    return 0;
  });

  // Limit to Google Indexing API daily quota (200 requests default)
  const quotaLimit = 200;
  const submitSet = urls.slice(0, quotaLimit);

  console.log(`Submitting top ${submitSet.length} URLs (quota limit: ${quotaLimit})...`);

  let successCount = 0;
  let failCount = 0;
  const submittedAt = new Date().toISOString();

  for (const item of submitSet) {
    console.log(`  Submitting: ${item.loc} (lastmod: ${item.lastmod || "none"}, hub: ${item.isHub})`);
    try {
      const result = await publishUrl(item.loc, credentials.accessToken, credentials.quotaProjectId);
      if (result.ok) {
        successCount++;
        history[item.loc] = submittedAt;
        const json = JSON.parse(result.data);
        console.log(`    ✓ OK: notificationId=${json.urlNotificationMetadata?.latestUpdate?.notifyTime || "success"}`);
      } else {
        failCount++;
        console.error(`    ✗ Failed (HTTP ${result.status}): ${result.data}`);
        if (result.status === 403) {
          console.error("    💡 Hint: Make sure the service account or authenticated user is verified as an Owner of this site in Google Search Console.");
        }
      }
    } catch (err) {
      failCount++;
      console.error(`    ✗ Network Error: ${err.message}`);
    }
    // Small sleep to avoid hitting rate limits
    await new Promise(r => setTimeout(r, 100));
  }

  // Save updated history
  if (successCount > 0) {
    try {
      fs.writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2), "utf8");
      console.log(`\n✓ Indexing history updated and saved to data/indexing-history.json`);
    } catch (e) {
      console.error("✗ Failed to save indexing history file:", e.message);
    }
  }

  console.log("\n=========================================");
  console.log(`Submission complete!`);
  console.log(`Successful: ${successCount}`);
  console.log(`Failed:     ${failCount}`);
  console.log("=========================================");

  process.exit(failCount > 0 && successCount === 0 ? 1 : 0);
}

main();
