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

# Run the indexing script using Node.js directly
/opt/homebrew/bin/node scripts/publish-indexing.mjs >> tmp/local-indexing.log 2>&1

# Log end time
echo "=== Indexing job finished at $(date) ===" >> tmp/local-indexing.log
echo "" >> tmp/local-indexing.log
