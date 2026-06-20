# Curbox Browser

<img src="public/icon/icon.svg">

A calm companion for mindful browsing, built to mirror the Curbox Android app so
moving between them feels familiar. It carries the same four features by the same
names:

- **Usage Stats** — today's total, a weekly bar graph you can page through, and a
  per site breakdown with expandable paths.
- **Website Blocker** — groups of whole websites paused by one of three modes:
  Usage Based, Time Based, or On each open.
- **Keyword Blocker** — groups of URL keywords (`youtube.com/shorts`, `/reels`,
  `*.reddit.com`, `r:shorts|reels`) blocked across the browser.
- **Warning Screen** — what happens when you try to get past a block: Never
  unlock, Require effort (type a sentence or state your intent), or Wait to
  unlock, plus a delay timer, custom message, and proceed limits.

When a site is paused it shows a breathing overlay instead of a hard block.

## Installation

Since the extension is not yet available on browser stores, you can install it manually.

### For Chrome, Brave, and other Chromium-based browsers

1. Download the project files.
2. Open a terminal in the project folder and run `npm install` followed by `npm run build`.
3. This will create a `.output/chrome-mv3` directory.
4. Open your browser's extension page (e.g., `chrome://extensions`).
5. Enable "Developer mode".
6. Click "Load unpacked" and select the `.output/chrome-mv3` directory.

### For Firefox

1. Download the project files.
2. Open a terminal in the project folder and run `npm install` followed by `npm run build:firefox`.
3. This will create a `.output/firefox-mv2` directory.
4. Open Firefox and go to `about:debugging`.
5. Click "This Firefox" and then "Load Temporary Add-on...".
6. Select any file inside the `.output/firefox-mv2` directory.
