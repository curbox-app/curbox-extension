# Curbox Browser

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

## Stack

- [WXT](https://wxt.dev) (Chromium MV3 + Firefox MV2)
- TypeScript, React, Tailwind CSS v4

## Develop

```bash
npm install
npm run dev          # Chromium (loads a dev profile)
npm run dev:firefox  # Firefox
```

## Build

```bash
npm run build         # .output/chrome-mv3
npm run build:firefox # .output/firefox-mv2
npm run zip           # packaged zip for the store
```

Load the unpacked folder from `.output/` in your browser's extensions page.

## How it works

- **Background service worker** (`src/entrypoints/background.ts`) orchestrates
  the core logic:
  - `core/usage.ts` tracks active time, only while the tab is focused and visible.
  - `core/blocker.ts` evaluates every block group (website and keyword) against
    the current URL, its blocking mode, schedule, and any temporary grant.
  - `lib/match.ts` implements the keyword syntax (domains, paths, wildcards,
    domain words, and `r:` regex).
- **Content script** (`src/entrypoints/content.ts`) reports page visibility and
  SPA navigation, and injects the Warning Screen overlay (`src/content/overlay.ts`)
  in a shadow root so page styles never leak in.
- **Popup** (`src/entrypoints/popup`) is the Usage view.
- **Options** (`src/entrypoints/options`) is the Reducers dashboard: Usage,
  Website Blocker, Keyword Blocker, and a log of stated intents.

All state lives in `chrome.storage.local` behind the typed helpers in
`src/lib/storage.ts`.

## Fonts

Large stats use Coolvetica. Drop `coolvetica.woff2` into `public/fonts/` to enable
it; a condensed fallback renders until then. Body text uses Inter with a system
fallback.
