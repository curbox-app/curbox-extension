# Curbox Browser Design

This document describes the architecture and behavior implemented in this repository. The extension is a browser-side companion for mindful browsing: its usage and configuration are local by default, while the sync subsystem is prepared behind a provider interface but is not connected to a remote service in this build.

## Product and interaction principles

- Make browsing time visible and rules understandable.
- Put a calm pause in front of blocked pages rather than silently redirecting or presenting a punitive hard wall.
- Count time only when there is evidence that the user is engaged with the page.
- Keep the product usable on Chromium desktop, Firefox desktop, and Firefox for Android, including places where the browser APIs differ.
- Match the Android app's vocabulary and rule semantics where the shared feature model calls for it.
- Keep changes to reducer settings live: the background reevaluates affected tabs and pushes current settings into existing content scripts.

The contributor-facing copy guidance is in [CONTRIBUTING.md](CONTRIBUTING.md): first-person language, simple phrasing, and a calm tone.

## Runtime architecture

The extension is built with WXT, TypeScript, React 19, and Tailwind CSS 4. `wxt.config.ts` defines the React module, build styling, manifest permissions, and browser-specific settings. The two generated app pages share the same React app: the toolbar opens `panel.html` in a compact desktop popup when window APIs are available and otherwise opens the `options.html` page in a tab.

```text
React app pages  <---- storage.local change events
       |                         |
       | runtime messages        | settings pushed to tabs
       v                         v
Background service worker <----> content script in each page
       |                              |
       +-- storage.local              +-- warning overlay
       +-- storage.session            +-- gentle prompt
       +-- browser tabs/alarms/idle    +-- grayscale / UI hider
```

### Background service worker

`src/entrypoints/background.ts` owns coordination and browser events. It loads the data needed for blocker evaluation once per pass, evaluates tabs on navigation, tab activation, settings/focus changes, and timer alarms, then sends a verdict only when it differs from the last verdict delivered to that tab. Work triggered by related storage changes is coalesced briefly to avoid redundant all-tab passes.

The worker also owns toolbar opening behavior, tab/window focus tracking, proceed grants, focus end alarms, unlock expiry alarms, imported-list reconciliation, and the runtime message boundary. Browser pages that cannot host a content script are skipped. When a blocked verdict reaches an older open tab without a listener, the worker attempts a one-time content-script injection using `scripting` and falls back to `tabs.executeScript` for Firefox variants that expose the legacy API.

### Content scripts

`src/entrypoints/content.ts` runs at `document_start` on all web URLs. Each page creates a local settings feed and four independent page features:

- **Block overlay:** requests an initial decision before the page paints, then handles background verdicts. It uses a Shadow DOM root so page styles do not affect Curbox UI. The overlay pauses existing media and prevents new media playback while blocked, locks page scrolling, traps keyboard focus, and routes Escape to the leave action. Identical decisions leave the current DOM alone so polling does not erase challenge input or restart a countdown.
- **Gentle prompt:** does a cheap local site match before asking the worker for values, then refreshes dynamic values while the page is visible. The prompt is pointer-transparent, rendered in a Shadow DOM, and positioned using normalized viewport coordinates.
- **Grayscale:** injects a small style at document start and checks again on minute boundaries so scheduled transitions apply without a reload.
- **UI Hider:** applies site-specific CSS before paint and mirrors the current path onto the root element for single-page navigation rules. Optional imperative rules are polled only while the page is visible.

The worker sends settings into the page feed; individual page features subscribe to that feed. Content scripts do not watch extension storage directly, avoiding unnecessary storage events on pages. Visibility, window focus, tab audio, and navigation are reported through typed runtime messages in `src/lib/messages.ts`.

### React app

`src/ui/shell.tsx` provides four main tabs: Usage, Focus, Reducers, and Info. Reducers contains Website Blocker, UI Hider, Gentle Prompts, Grayscale, and Sync subpages. The Sync panel is loaded lazily because it and its QR library are not part of the common path. The shared shell chooses popup or page sizing; Onboarding and terms consent gate the main app on first use.

`src/ui/useStore.ts` loads settings, usage, focus state/log, and onboarding state, then subscribes to `storage.local` changes. Usage is split across per-day keys, so a tick only updates the affected day's data. The shell keeps an editable settings draft and writes committed settings through the shared storage API. `ErrorBoundary` isolates a failing screen from the rest of the app.

The visual system is defined in `src/ui/theme.css`: a dark palette expressed as CSS variables, Coolvetica for display headings and Inter for readable text, rounded cards and pills, visible keyboard focus, and restrained motion. The in-page prompt and warning screen have their own compact CSS, while sharing Inter and reduced-motion behavior.

## State and persistence

`src/lib/types.ts` is the canonical model for settings and runtime records. Settings schema version 2 contains:

- blocker groups with matchers, imported-list references, weekly schedules, usage limits, and warning configuration;
- focus groups and current focus/Pomodoro state;
- gentle-prompt and grayscale configuration;
- enabled UI Hider rule IDs, ignored usage sites, and usage background art selection.

`normalizeSettings` is the compatibility boundary. Reads and writes normalize settings, fill defaults, clamp numeric values, and convert older blocker schedules without changing their intent. New settings fields should be introduced through the canonical types and normalization path.

`src/lib/storage.ts` wraps `browser.storage.local`. It provides typed defaults, per-key serialized updates to prevent lost mutations, storage change subscriptions, legacy settings and usage migration, and a worker-side memory cache for frequently read small records. Large imported word-list text is deliberately excluded from that cache. Usage has separate `usage:YYYY-MM-DD` keys; the storage layer can read old monolithic usage and migrate it. The usage retention policy keeps 28 days and prunes older day keys.

| Data | Storage and purpose |
| --- | --- |
| Settings, focus state/log, grants, proceeds, terms, opens | `storage.local`; local product state |
| Daily usage | `storage.local` under one key per local calendar day |
| Imported list contents | `storage.local` separately from settings; only compact list references are in groups |
| In-flight usage tracker snapshot | `storage.session`, so service worker restarts can recover pending spans without preserving them across browser restart |
| Sync cursor, key material, vault metadata, preferences, remote usage view | Additional `storage.local` keys used by the dormant sync implementation |

Usage measurement state lives in `src/core/usage.ts`. It accumulates into an in-memory daily buffer and persists on alarms rather than writing for every tab or visibility event. A snapshot in `storage.session` preserves active tab, current gates, and unpersisted deltas across service worker restarts. Spans are split by local day and hour; implausibly long spans are discarded as process-suspension gaps, and failed writes put the batch back for retry.

The tracker runs only when a page is selected, its browser window is focused, the page is visible, and the OS idle state is active. If the machine reports idle, audible tab playback is treated as evidence of passive engagement; a locked machine never counts. Firefox for Android may lack window and idle APIs, so the implementation degrades to the APIs available there. Usage paths are capped per domain, with overflow folded into `/` to bound storage growth.

## Core behavior

### URL and matching model

`src/lib/url.ts` reduces a URL to a normalized domain and path. Browser-internal and unsupported schemes are excluded; `www.` and trailing hostname dots are normalized. `src/lib/match.ts` implements Android-compatible patterns: whole domains, URL paths, path-only rules, wildcards, and `r:` regular expressions against domain plus path/query/fragment. Expressions are compiled and cached. Imported lists use exact domain sets for ordinary host names and the matcher engine for non-domain patterns. A listed parent domain includes subdomains.

### Block decisions

`src/core/blocker.ts` is a mostly pure decision function. It evaluates in this order:

1. An active focus session takes precedence. `only-these` blocks matching sites; `all-except` blocks sites outside the group. Pomodoro breaks suspend focus blocking.
2. Enabled blocker groups are checked in settings order for a target match and an active local-time window.
3. A matching group blocks if it is an on-each-open group, its current day's limit is zero, or usage inside its active window has reached the configured limit.
4. A valid temporary grant suppresses the group warning; otherwise the decision includes the warning, proceed availability, focus-goal remainder, and proceed-limit status.

Schedules use local weekday/time values, support ranges crossing midnight, and carry active-window start/end timestamps so only usage inside the window is charged. For legacy aggregate usage without hourly buckets, a limit can use the total only when its window covers the whole local day; newly collected usage has per-path hourly buckets for precise overlap calculations. Daily usage limits use the current calendar day's configured limit, including for a window that began the prior evening.

On-each-open grants are scoped to a group and remain while the user stays inside any target in that group; leaving clears the grant. Other proceed grants last the selected or configured unlock time. Proceed records track timestamps for a rolling frequency cap, with compatibility for older count/window records. The warning supports never unlock, typing/intent/math effort challenges, fixed or user-selected unlock length, a delay, proceed frequency limits, daily focus goals, and custom wording. The overlay enforces the interaction locally; the worker records a proceed and reevaluates the tab.

### Focus and Pomodoro

`src/core/focus.ts` stores one active session with the selected focus group's domains and mode. Focus state is durable so it survives a worker restart. Timed sessions end through an alarm; ending or completing a focus round writes a bounded focus log. Finalization is serialized and checks the expected session start time so a racing expiry or end action cannot settle a newer session.

Pomodoro is modeled as phases on that same session. Each completed focus round is logged separately; breaks are not logged and sites are unblocked during a break. When the browser wakes after a phase expired, the next phase begins at the current time rather than retroactively catching up. The Focus UI includes a minute ruler, duration entry, editable focus groups, session controls, and statistics derived from the focus log.

### Other reducers and usage views

- **UI Hider:** `src/lib/ui-hider.ts` holds selectors and optional imperative behavior by site. Current built-in rules cover YouTube's home feed, recommendations, comments, Shorts, live chat and notification count, plus X's For You tab. CSS and rule IDs are shared by the editor and content script.
- **Grayscale:** each enabled matching group applies during its configured schedule; it is independent of blocker groups.
- **Gentle prompts:** message templates share Android variable names. The worker derives daily site usage, opens, total screen time, matching group totals, reel-path counts, and a live page session duration.
- **Usage:** views and helpers aggregate by local date, domain, and path. The UI supports daily/weekly periods, path details, ignored sites, ASCII art, and CSV export. Sync usage, if a provider is enabled, is displayed as a merged view while local usage remains separate.
- **Website lists:** text and hosts files are parsed, deduplicated, and stored outside settings. Website-pack references can be downloaded from the community pack repository; compiled domain sets and patterns are cached and invalidated when list storage changes. Unreferenced imports get a 24-hour grace period before cleanup so an editor does not lose an unsaved import.

## Sync subsystem status

The sync implementation is intentionally transport-agnostic. `src/lib/sync/provider.ts` defines the remote auth, vault, device, record, subscription, and cursor APIs. `src/lib/sync/engine.ts` owns encryption, local merge behavior, change detection, debounced pushes, pagination/cursors, and account state. `src/lib/crypto.ts` defines the shared wire format: PBKDF2-HMAC-SHA256 derives a key-encryption key; AES-256-GCM wraps a random data-encryption key and encrypts records; record AAD binds ciphertext to user, namespace, and record key. Pairing payloads transfer the account identity and data key. The format is mirrored by the Android app and covered by known-vector tests.

No `SyncProvider` is registered in this repository. As a result, the engine reports sync as unavailable and no remote account, billing, or data transfer occurs. The account UI and message protocol are present for a future provider integration; they are not evidence that sync is active in the shipped extension. The README's local-only statement is the current runtime behavior.

## Browser packaging and permissions

The default build targets Chromium Manifest V3; `npm run build:firefox` targets Firefox Manifest V2. The manifest grants local storage, unlimited storage, tabs, alarms, idle, scripting, and all-URL host access for the page features. Chromium additionally requests `favicon`; Firefox omits that unsupported permission. Firefox metadata declares no required data collection and a minimum version of 128. The toolbar uses either `action` or `browserAction`; the UI falls back from desktop popup windows to an app tab, and injection falls back to the legacy Firefox API where necessary.

## Source map

| Path | Responsibility |
| --- | --- |
| `src/entrypoints` | WXT background, content script, and React page entrypoints |
| `src/core` | Usage tracker, blocker evaluation, focus lifecycle, grants, list compilation, and grayscale decisions |
| `src/content` | In-page overlay, prompts, settings feed, grayscale styles, and UI hiding |
| `src/lib` | Canonical types, storage, URL matching, usage aggregation/export, prompt formatting, crypto, and sync engine |
| `src/ui` | Shared app shell, Usage/Focus/Reducer screens, editors, account UI, and theme |
| `public` | Extension icons and bundled fonts |
| `docs` | Release notes and checked-in product screenshots |

## Development and verification

Install dependencies with `npm install`. `npm run dev` runs the Chromium WXT development build; `npm run dev:firefox` selects Firefox. Production packages use `npm run build` or `npm run build:firefox`. `npm run compile` type-checks with TypeScript, `npm test` runs Vitest, and `npm run lint:firefox` builds and invokes Mozilla's add-on linter. `npm run zip` and `npm run zip:firefox` produce browser packages. Firefox-specific release steps are documented in `docs/firefox-release.md`.
