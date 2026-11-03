# Firefox release

This is the checklist for publishing Curbox Browser on addons.mozilla.org (AMO). A **listed** release appears publicly on AMO after review. An **unlisted** release is signed but only installable by people who have the file, which suits private test builds.

## 1. Build and check

```bash
npm ci                    # clean install from package-lock.json
npm test                  # unit tests
npm run lint:firefox      # build the Firefox add-on and run Mozilla's linter
npm run zip:firefox       # make the files to upload
```

`npm run zip:firefox` writes two files to `.output/`:

| File | What it is |
| --- | --- |
| `curbox-extension-<version>-firefox.zip` | The add-on itself |
| `curbox-extension-<version>-sources.zip` | The source code Mozilla needs to review the bundled code |

Expected linter result: **0 errors**, and these 2 warnings, which are safe to ship:

| Warning | Why it is fine |
| --- | --- |
| `UNSAFE_VAR_ASSIGNMENT` (two in `chunks/shell-*.js`) | These are inside React DOM's own code: one renders `dangerouslySetInnerHTML` and one creates `<script>` elements. Curbox uses neither, and never assigns `innerHTML` itself. |

The minimum versions are Firefox 140 and Firefox for Android 142, the first versions that read `data_collection_permissions`, which AMO requires for new add-ons.

Each release must have a higher `version` in `package.json` than the last one uploaded to AMO, because AMO rejects a version number it has already seen.

## 2. Publish on AMO

1. Go to the [AMO Developer Hub](https://addons.mozilla.org/developers/addon/submit/distribution) and choose **On this site** (listed).
2. Upload `curbox-extension-<version>-firefox.zip`. This is the file AMO validates.
3. When asked whether the add-on uses a bundler, minifier or other tool, say **yes** and upload `curbox-extension-<version>-sources.zip`.
4. Fill in the listing from section 5 and paste the notes from section 4 into **Notes to Reviewer**. Leave **This add-on is experimental** unticked for a stable release.
5. Submit. Listed versions go public once a reviewer approves them.

For a private test build instead, choose **On your own** (unlisted) in step 1, or sign from the terminal with an [AMO API key](https://addons.mozilla.org/developers/addon/api/key/):

```bash
npx web-ext sign \
  --channel unlisted \
  --source-dir .output/firefox-mv2 \
  --upload-source-code .output/curbox-extension-<version>-sources.zip \
  --api-key "$AMO_JWT_ISSUER" \
  --api-secret "$AMO_JWT_SECRET"
```

The add-on ID is `curbox@curbox.app` (set in `wxt.config.ts`). It is permanent once the first version is uploaded.

## 3. Test an unlisted build

**Firefox on a computer:** open the signed `.xpi` file in Firefox (drag it into a window, or open it from the downloads list) and click **Add**.

**Firefox for Android:** a file install needs the hidden debug menu. In Firefox, open **Settings > About Firefox** and tap the Firefox logo five times, then go back to **Settings** and use **Install extension from file** with the signed `.xpi`. If that option is missing in a tester's version, they can use Firefox Nightly, or install the listed release from AMO.

What to try:

- The first run introduction, including opening the Terms and Privacy Policy from the consent dialog.
- Usage stats after a few hours of normal browsing.
- A website blocker group with a short daily limit, and each unlock challenge on the warning screen.
- A focus session with the Pomodoro timer through at least one break.
- Gentle Prompts, the Grayscale Filter and the UI Hider on YouTube and X.
- On Android: dragging the focus ruler, typing the minutes, and the dropdowns.

## 4. Notes to Reviewer

Paste this into the AMO **Notes to Reviewer** field:

```text
Curbox Browser is a screen time and website blocking extension. It is open source:
https://github.com/curbox-app/curbox-extension

BUILD
The add-on is built with WXT (Vite) from TypeScript and React sources. To reproduce it:
  1. Unzip the sources archive.
  2. npm ci
  3. npm run build:firefox
The output in .output/firefox-mv2 is identical to the submitted add-on.
Tested with Node.js 26.3.0 and npm 11.16.0 on macOS.

DATA
No data is collected or transmitted. Usage history, settings and focus history are stored
only in browser.storage.local. There are no analytics. Encrypted sync code is present in the
source but no sync service is connected in this build, so it never runs.

NETWORK REQUESTS
- api.github.com and raw.githubusercontent.com (repository curbox-app/website_packs):
  only when the user chooses to import a community list of websites to block.
- curbox.app/terms.html and curbox.app/privacy.html: shown in an iframe when the user
  opens the Terms or Privacy Policy from the first run consent dialog.
No remote code is loaded or executed.

PERMISSIONS
- storage, unlimitedStorage: keep usage history and imported block lists on the device.
- tabs: know which site is active so only time actually spent is counted.
- alarms: save usage regularly and end focus sessions and temporary unlocks on time.
- idle: pause time tracking when the user steps away or locks the screen.
- scripting: show the warning screen on tabs that were already open when a block starts.
- <all_urls>: the content script shows the warning screen, Gentle Prompts, the grayscale
  filter and UI hiding on whichever sites the user configures. Site rules are matched
  locally.

INNERHTML WARNINGS
The two UNSAFE_VAR_ASSIGNMENT warnings are inside React DOM (chunks/shell-*.js). Curbox's own
code builds all DOM with createElement and textContent.

TESTING
Open the toolbar button. A first run introduction and consent dialog appear; press I agree.
To see a block: Reducers > Website Blocker > add a group with a site such as example.com and
a daily limit of 0 minutes, then visit that site.
```

## 5. Listing details

| Field | Value |
| --- | --- |
| Name | Curbox: Website Blocker & Screen Time |
| URL | `curbox` |
| Summary | Block distracting websites, set daily limits and see where your time really goes online. Focus sessions with a Pomodoro timer, calm warning screens and mindful nudges. Open source and private: your data never leaves your browser. |
| Experimental | No |
| Category | Privacy & Security |
| Support email | aguptaq88@gmail.com |
| Support site | https://github.com/curbox-app/curbox-extension/issues |
| License | Must match the LICENSE file in this repository |
| Privacy policy | Yes, see https://curbox.app/privacy.html |
| Data collection | None |
| Screenshots | `docs/screenshots/` |
| Description | Start from the feature sections in `README.md`. Keep dashes out of listing text. |
