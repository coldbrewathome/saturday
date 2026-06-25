#!/bin/bash

# Target location for LaunchAgents
PLIST_DEST="$HOME/Library/LaunchAgents/com.famhop.indexing.plist"
PLIST_SRC="/Users/kning/Projects/saturday/scripts/com.famhop.indexing.plist"

echo "Configuring local scheduled task on macOS..."

# Copy plist to User's LaunchAgents
cp "$PLIST_SRC" "$PLIST_DEST"
chmod 644 "$PLIST_DEST"
echo "✓ Plist copied to $PLIST_DEST"

# Unload agent if it is already loaded
launchctl unload "$PLIST_DEST" 2>/dev/null || true

# Load agent
launchctl load "$PLIST_DEST"
echo "✓ Agent registered with launchd"

# Run it immediately to test
echo "Running the job now to verify everything works..."
launchctl start com.famhop.indexing

echo "✓ Setup complete! Logs will be written to /Users/kning/Projects/saturday/tmp/local-indexing.log"
echo "You can check the logs using: tail -f /Users/kning/Projects/saturday/tmp/local-indexing.log"
