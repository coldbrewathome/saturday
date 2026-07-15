#!/bin/bash
# Local cron script for running Google Indexing API publisher

# Set working directory to the project root
cd /Users/kning/Projects/saturday || exit 1

# Add Homebrew and system paths to PATH so node/npm/gcloud are found
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin"

# Set the Google Cloud project ID
export GOOGLE_CLOUD_PROJECT="leafy-acumen-468616-d1"

# Create tmp directory if it doesn't exist
mkdir -p tmp

# Log start time
echo "=== Indexing job started at $(date) ===" >> tmp/local-indexing.log

# publish-indexing.mjs reads dist/sitemap.xml, and dist/ is shared by both
# brands — a `npm run deploy:adults` leaves Mosey's sitemap there. Without this
# rebuild the cron silently spends FamHop's entire ~200/day quota on Mosey URLs
# (this happened on 2026-07-11). Rebuild FamHop so the sitemap is unambiguous.
echo "Rebuilding FamHop so dist/sitemap.xml is FamHop's..." >> tmp/local-indexing.log
if ! /opt/homebrew/bin/npm run build >> tmp/local-indexing.log 2>&1; then
  echo "BUILD FAILED — skipping indexing rather than submitting a stale sitemap" >> tmp/local-indexing.log
  echo "=== Indexing job aborted at $(date) ===" >> tmp/local-indexing.log
  exit 1
fi

# Run the indexing script using Node.js directly (FamHop / famhop.com)
/opt/homebrew/bin/node scripts/publish-indexing.mjs >> tmp/local-indexing.log 2>&1

# Now do Mosey (trymosey.com), which was NEVER submitted before 2026-07-14. Rebuild adults so
# dist/sitemap.xml becomes Mosey's, then submit. Both brands share leafy-acumen's ~200/day
# Indexing API quota, but publish-indexing.mjs dedupes against data/indexing-history.json, so a
# normal day only submits each brand's genuinely new/modified URLs. dist/ is left as Mosey's;
# the next run's FamHop rebuild at the top makes it unambiguous again.
echo "Rebuilding Mosey so dist/sitemap.xml is trymosey's..." >> tmp/local-indexing.log
if /opt/homebrew/bin/npm run build:adults >> tmp/local-indexing.log 2>&1; then
  /opt/homebrew/bin/node scripts/publish-indexing.mjs >> tmp/local-indexing.log 2>&1
else
  echo "Mosey build FAILED — skipping Mosey indexing (FamHop already submitted above)" >> tmp/local-indexing.log
fi

# Log end time
echo "=== Indexing job finished at $(date) ===" >> tmp/local-indexing.log
echo "" >> tmp/local-indexing.log
