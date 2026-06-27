import fs from "node:fs";
import path from "node:path";

const ADC_PATH = "/Users/kning/.config/gcloud/application_default_credentials.json";

async function getAccessTokenAndQuotaProject() {
  if (!fs.existsSync(ADC_PATH)) {
    throw new Error(`Application Default Credentials not found at ${ADC_PATH}. Please run:
gcloud auth application-default login`);
  }

  const adc = JSON.parse(fs.readFileSync(ADC_PATH, "utf8"));
  if (!adc.refresh_token) {
    throw new Error("Refresh token not found in ADC file.");
  }

  console.log("Exchanging refresh token for access token...");
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
    const errorText = await res.text();
    throw new Error(`Failed to exchange refresh token: ${res.statusText}\n${errorText}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    quotaProjectId: adc.quota_project_id,
  };
}

async function main() {
  try {
    const { accessToken, quotaProjectId } = await getAccessTokenAndQuotaProject();
    console.log("Successfully obtained access token. Quota Project:", quotaProjectId);

    const headers = { Authorization: `Bearer ${accessToken}` };
    if (quotaProjectId) {
      headers["X-Goog-User-Project"] = quotaProjectId;
    }

    console.log("Listing Search Console sites...");
    const sitesRes = await fetch("https://www.googleapis.com/webmasters/v3/sites", {
      headers,
    });

    if (!sitesRes.ok) {
      const err = await sitesRes.json();
      if (err.error?.status === "PERMISSION_DENIED" || err.error?.code === 403) {
        console.error("\n✗ Permission Denied / Insufficient Scopes.");
        console.error(err.error?.message || "");
        console.error("Please run the following command to re-authenticate with Search Console scope:\n");
        console.error("  gcloud auth application-default login --scopes=https://www.googleapis.com/auth/webmasters.readonly,https://www.googleapis.com/auth/cloud-platform,https://www.googleapis.com/auth/userinfo.email,openid\n");
        process.exit(1);
      }
      throw new Error(`Failed to list sites: ${sitesRes.statusText}\n${JSON.stringify(err)}`);
    }

    const sitesData = await sitesRes.json();
    console.log(`Found ${sitesData.siteEntry?.length || 0} sites in Search Console.`);

    if (!sitesData.siteEntry || sitesData.siteEntry.length === 0) {
      console.log("No sites found. Exiting.");
      return;
    }

    const targetDomains = ["famhop.com", "trymosey.com"];
    const results = {};

    for (const entry of sitesData.siteEntry) {
      const siteUrl = entry.siteUrl;
      const isTarget = targetDomains.some(domain => siteUrl.includes(domain));
      if (!isTarget) continue;

      console.log(`\n=========================================`);
      console.log(`Processing site: ${siteUrl} (permissionLevel: ${entry.permissionLevel})`);
      console.log(`=========================================`);

      results[siteUrl] = {
        siteUrl,
        permissionLevel: entry.permissionLevel,
      };

      // 1. Fetch Sitemaps
      try {
        console.log(`Fetching sitemaps for ${siteUrl}...`);
        const sitemapsRes = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/sitemaps`, {
          headers,
        });
        if (sitemapsRes.ok) {
          const sitemapsData = await sitemapsRes.json();
          results[siteUrl].sitemaps = sitemapsData.sitemap || [];
          console.log(`  Found ${results[siteUrl].sitemaps.length} sitemaps.`);
        } else {
          console.error(`  Failed to fetch sitemaps: ${sitemapsRes.statusText}`);
        }
      } catch (e) {
        console.error(`  Error fetching sitemaps: ${e.message}`);
      }

      // 2. Fetch Search Analytics (last 30 days)
      try {
        console.log(`Fetching search analytics for ${siteUrl}...`);
        
        // Calculate date range: today to 30 days ago
        const endDate = new Date();
        // search console usually has 2-3 days lag, so end date should be 2 days ago
        endDate.setDate(endDate.getDate() - 2);
        const startDate = new Date();
        startDate.setDate(endDate.getDate() - 30);
        
        const formatDate = (d) => d.toISOString().split("T")[0];
        const startStr = formatDate(startDate);
        const endStr = formatDate(endDate);
        console.log(`  Date range: ${startStr} to ${endStr}`);

        // Query performance summary
        const summaryRes = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: startStr,
            endDate: endStr,
          }),
        });

        if (summaryRes.ok) {
          const summaryData = await summaryRes.json();
          results[siteUrl].performanceSummary = summaryData.rows?.[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
          console.log(`  Summary: clicks=${results[siteUrl].performanceSummary.clicks}, impressions=${results[siteUrl].performanceSummary.impressions}`);
        } else {
          console.error(`  Failed to fetch performance summary: ${summaryRes.statusText}`);
        }

        // Query top queries
        const queriesRes = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: startStr,
            endDate: endStr,
            dimensions: ["query"],
            rowLimit: 20,
          }),
        });

        if (queriesRes.ok) {
          const queriesData = await queriesRes.json();
          results[siteUrl].topQueries = queriesData.rows || [];
          console.log(`  Found ${results[siteUrl].topQueries.length} top queries.`);
        } else {
          console.error(`  Failed to fetch top queries: ${queriesRes.statusText}`);
        }

        // Query top pages
        const pagesRes = await fetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`, {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            startDate: startStr,
            endDate: endStr,
            dimensions: ["page"],
            rowLimit: 20,
          }),
        });

        if (pagesRes.ok) {
          const pagesData = await pagesRes.json();
          results[siteUrl].topPages = pagesData.rows || [];
          console.log(`  Found ${results[siteUrl].topPages.length} top pages.`);
        } else {
          console.error(`  Failed to fetch top pages: ${pagesRes.statusText}`);
        }

      } catch (e) {
        console.error(`  Error fetching search analytics: ${e.message}`);
      }
    }

    fs.writeFileSync(
      path.resolve("scripts", "gsc-data.json"),
      JSON.stringify(results, null, 2)
    );
    console.log("\n✓ GSC data saved to scripts/gsc-data.json");

  } catch (e) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }
}

main();
