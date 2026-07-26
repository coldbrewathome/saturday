# Pinterest Daily Pin Poster — Dispatch Skill

## What this does
Posts the day's batch of FamHop pins to Pinterest by automating the Chrome browser.

## Prerequisites
- Pinterest must be logged in as FamHop (hopwithfamhop) in Chrome
- Pin queue files must exist at `~/Projects/saturday/marketing/pinterest/pinterest-automation/pins-queue/`
- Weekend poster images at `~/Projects/saturday/public/weekend-posters/`

## Daily Execution Steps

### 1. Load today's queue
Read the pin queue file for today's date from `pins-queue/YYYY-MM-DD.json`.
If no queue exists, run the generator first:
```
cd ~/Projects/saturday/marketing/pinterest/pinterest-automation
python3 generate_pins.py
```

### 2. Check/create boards
Before posting, verify all required boards exist on Pinterest:
- Navigate to pinterest.com/hopwithfamhop and check the "Saved" tab
- For any missing boards from config.json, create them:
  - Click "+" on profile > "Board"
  - Enter board name and description from config.json
- The 16 city boards + "Weekend with Kids" should all exist

### 3. Post each pin
For each pin with status "pending" in the queue:

a. Navigate to `pinterest.com/pin-creation-tool/`
b. Find the file upload input and upload the image from `image_path`
c. Wait 2 seconds for upload
d. Find and fill the Title field using form_input
e. Click the Description field and type the description text
f. Scroll down to find the Link field, fill it using form_input
g. If the Board isn't "Weekend with Kids" (the default), click the Board dropdown and select the correct board. If the board doesn't exist yet, create it first.
h. Scroll up, click a neutral area to blur inputs, then click Publish
i. Wait 5 seconds for publish to complete
j. Verify the form reset (empty upload area = success)
k. Close the Pin drafts sidebar if it appears

**Important quirks learned from manual posting:**
- The Publish button sometimes doesn't register if an input field is focused. Always click a neutral area first to blur, then click Publish.
- If Publish doesn't work via coordinate click, try JavaScript: `document.querySelectorAll('button').forEach(b => { if (b.textContent.trim() === 'Publish') b.click() })`
- After uploading an image, wait 2 seconds before filling fields
- The Description field is a combobox, not a regular textarea. Click it first, then type.

### 4. Track progress
After each successful pin post:
- Update the pin's status to "posted" in the queue JSON
- Save the file so progress is preserved if the session is interrupted

### 5. Post-run cleanup
After all pins are posted:
- Move the queue file to `pins-posted/` directory
- Report summary: X pins posted, Y failures

## Posting Cadence
- Space pins ~2-3 minutes apart (not all at once)
- Total posting session: ~60-90 minutes for 30 pins
- Best time to run: 5-8pm PT (peak Pinterest hours for US parents)

## Error Handling
- If a pin fails to publish, skip it and continue with the next one
- Log failed pins with the error reason
- Retry failed pins at the end of the batch
