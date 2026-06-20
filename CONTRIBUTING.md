<div align="center">

# Contributing to Curbox

Thanks for being here. Curbox stays free because people pitch in, and that includes you.

[Discord](https://discord.com/invite/Vs9mwUtuCN) · [Report a bug](https://github.com/curbox-app/curbox-extension/issues) · [Donate](https://curbox.app/donate)

</div>

---

## Ways to help

- **Report bugs** so we can squash them.
- **Suggest enhancements** that fit the calm, minimal spirit.
- **Send pull requests** for fixes and features.
- **Improve the docs** when something reads unclear.

Not a coder? Sharing the project and hanging out in the [Discord](https://discord.com/invite/Vs9mwUtuCN) helps just as much.

## Getting started

```bash
# 1. Fork, then clone your fork
git clone https://github.com/<you>/curbox-extension.git
cd curbox-extension

# 2. Install dependencies
npm install

# 3. Start the dev server (Chromium)
npm run dev          # Firefox:  npm run dev:firefox
```

`npm run dev` builds the extension into `.output/` and reloads on save. Load that folder in your browser using the steps in the [README](README.md#installation).

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload (Chromium) |
| `npm run dev:firefox` | Dev server for Firefox |
| `npm run build` | Production build → `.output/chrome-mv3` |
| `npm run build:firefox` | Production build → `.output/firefox-mv2` |
| `npm run compile` | Type check with `tsc` |

## Architecture

The code splits across three layers.

**1. Background service worker.** This is where the core logic lives.
- **Usage Tracker** watches the active tab and tab switches.
- **Blocker** decides whether a URL should be paused.
- **Focus Mode** runs focus sessions.
- State is saved to `chrome.storage.local`.

**2. Content scripts.** These handle enforcement and tracking on the page.
- **Visibility Tracker** uses the Page Visibility API so time only counts when you are actually looking.
- **Overlay Injector** drops the breathing block overlay into the page.

**3. Popup and dashboard UI.** Built with React and Tailwind. This is the usage stats and the configuration screens.

## Code style

- **DRY**: do not repeat yourself.
- **Comments**: only where the intent is not obvious from the code.
- **TypeScript**: keep it typed and run `npm run compile` before you push.

## UX principles

These keep every screen feeling like Curbox. Match them in any user facing text.

- **Speak in first person.** "I'm helping you stay focused," not "Focus mode is active."
- **No dashes.** Never use a dash in text the user reads.
- **Simple language.** Crisp, calm, around a 6th grade reading level.
- **Peaceful friction.** Offer a pause, never a punishment.

## Opening a pull request

1. Branch off `main` for your fix or feature.
2. Make your changes, following the style and UX principles above.
3. Run `npm run compile` and confirm the build is clean.
4. Open the PR with a clear description of what changed and why.

<div align="center">

Thank you for helping people take their time back.

</div>
