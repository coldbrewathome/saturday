# Pinterest Pin Posting — Dispatch Automation Guide

## Overview
This document defines the automated posting workflow for Dispatch/Cowork to execute daily.

## Daily Workflow

### Step 1: Generate pin queue
Run the content engine to produce today's pin batch:
```bash
cd ~/Projects/saturday/marketing/pinterest/pinterest-automation
python3 generate_pins.py --days 1
```
This creates `pins-queue/YYYY-MM-DD.json` with ~25 pins.

### Step 2: Create missing boards
Before posting, check if all city boards exist on Pinterest. If not, create them:
1. Navigate to pinterest.com/hopwithfamhop
2. For each board in config.json that doesn't exist yet, click "+" > "Board"
3. Enter the board name and description from config.json

### Step 3: Post pins
For each pin in today's queue file:
1. Navigate to pinterest.com/pin-creation-tool/
2. Upload the image from the `image_path` field
3. Fill in Title, Description, Link
4. Select the correct Board
5. Click Publish
6. Wait 3-5 seconds between pins
7. Mark pin as "posted" in the queue file

### Step 4: Move completed queue
After all pins are posted, move the queue file to `pins-posted/` directory.

## Pin Queue Format
Each pin in the queue JSON:
```json
{
  "id": "bay-area_2026-07-25_v0",
  "city_id": "bay-area",
  "city": "Bay Area",
  "type": "weekend_roundup",
  "title": "Things to Do with Kids in the Bay Area This Weekend (Jul 25–26)",
  "description": "182 family events across the Bay...",
  "link": "https://famhop.com/bay-area/this-weekend/",
  "board": "Bay Area Family Events",
  "image_path": "/path/to/bay-area.png",
  "status": "pending",
  "scheduled_date": "2026-07-25"
}
```

## Board Creation
Boards to create (from config.json cities):
- Bay Area Family Events
- Los Angeles Family Events
- NYC Family Events
- Chicago Family Events
- DFW Family Events
- Houston Family Events
- Washington DC Family Events
- Atlanta Family Events
- Philly Family Events
- Miami Family Events
- Phoenix Family Events
- Boston Family Events
- San Diego Family Events
- Honolulu & Oahu Family Events
- Austin Family Events
- Seattle Family Events

The "Weekend with Kids" board already exists.

## Scheduling
Target: spread pins across US evening hours (8pm-11pm ET = 00:00-03:00 UTC)
With ~25 pins/day, post roughly every 20-30 minutes during peak hours.
