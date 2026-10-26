<div align="center">

<img src="public/icon/icon.svg" width="88" height="88" alt="Curbox">

# Curbox Browser

**Break the doomscroll.**

A browser extension that shows where your time actually goes online. It blocks the sites and feeds that keep pulling you back, and when you hit one it puts a calm breathing screen in the way instead of a hard wall. There is also a [Curbox app for Android](https://curbox.app/install-android) if you want the same thing on your phone.

[![Chromium](https://img.shields.io/badge/Chromium-MV3-444?logo=googlechrome&logoColor=white)](#for-chrome-brave-and-other-chromium-browsers)
[![Firefox](https://img.shields.io/badge/Firefox-MV2-444?logo=firefoxbrowser&logoColor=white)](#for-firefox)
[![WXT](https://img.shields.io/badge/built%20with-WXT-444)](https://wxt.dev)
[![React](https://img.shields.io/badge/React-19-444?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.7-444?logo=typescript&logoColor=white)](https://www.typescriptlang.org)

[Discord](https://discord.com/invite/Vs9mwUtuCN) · [Donate](https://curbox.app/donate) · [Android app](https://curbox.app/install-android) · [Instagram](https://instagram.com/curb.me)

</div>

---

## Features

The toolbar button opens the whole app in its own window. Usage, focus, blockers, and info all live there. You do not need a separate settings tab.

### Usage Stats

See where your time actually goes. Curbox only counts a tab while you are looking at it, so something left open in the background never inflates your numbers. You get today's total at the top, a weekly bar graph you can scroll back through, and a list of sites sorted by time spent. Open any site and it breaks down by path, so `youtube.com` splits into the videos and the `/shorts` that quietly ate your afternoon.

### Website Blocker

Put websites into groups and combine the same controls used by the Android app:

- **Active hours.** Choose all day, one daily schedule, or different ranges by weekday.
- **Usage limits.** Count only browsing inside those active hours; a zero-minute limit blocks the whole window.
- **On each open.** Curbox stops you once when you enter a group, then asks again after you leave and return.

### Keyword Blocker

Block by URL pattern instead of a whole domain, so you can kill the feed and keep the tool. A group can hold keywords like:

- `youtube.com/shorts` for one section of a site
- `/reels` for a path on any site
- `*.reddit.com` for every subdomain
- `r:shorts|reels` for a raw regex when you need it

### Warning Screen

This is what you hit when you try to get past a block. Instead of a flat wall there is a breathing overlay that asks you to slow down for a second. You decide how hard it pushes back:

- **Never unlock.** The block holds and there is no way through.
- **Require effort.** Type a sentence, write down why you want in, or solve an adaptive math set.
- **Wait to unlock.** A timer runs before the page will open.

You can add your own message, require completed focus time first, and cap how many times you are allowed through, so it stays a pause and not a punishment.

### Encrypted Sync

Sync is not connected in this build. Settings and stats stay on this browser. The local encryption and merge path is ready for a future sync service, so adding one does not mean rewriting the rest of Curbox.

## Installation

Curbox is not on the browser stores yet, so you load it yourself. It takes about two minutes.

```bash
npm install        # grab dependencies
npm run build      # Chromium  →  .output/chrome-mv3
npm run build:firefox  # Firefox  →  .output/firefox-mv2
```

### For Chrome, Brave, and other Chromium browsers

1. Run `npm install` then `npm run build`.
2. Open your extensions page (for example `chrome://extensions`).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and pick the `.output/chrome-mv3` folder.

### For Firefox

1. Run `npm install` then `npm run build:firefox`.
2. Open `about:debugging` and click **This Firefox**.
3. Click **Load Temporary Add-on** and pick any file inside `.output/firefox-mv2`.

> Temporary add-ons in Firefox are removed when you restart the browser.

## Contributing

Issues, ideas, and pull requests are all welcome. See **[CONTRIBUTING.md](CONTRIBUTING.md)** to get set up.

<div align="center">

Made by [Nethical](https://github.com/nethical6) 

</div>
