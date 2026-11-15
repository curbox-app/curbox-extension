# Chrome Web Store release

This is the checklist for publishing Curbox Browser on the Chrome Web Store. The same package also works on Edge Add-ons, Brave and other Chromium browsers.

## 1. Build and check

```bash
npm ci          # clean install from package-lock.json
npm run compile # type check
npm test        # unit tests
npm run zip     # build and zip the Chromium add-on
```

`npm run zip` writes `.output/curbox-extension-<version>-chrome.zip`. Upload that file as it is. The store does not need a sources zip.

Each upload must have a higher `version` in `package.json` than the last one, because the store rejects a version it has already seen.

Before uploading, load `.output/chrome-mv3` unpacked (`chrome://extensions`, Developer mode, **Load unpacked**) and run through the test list in `firefox-release.md` section 3.

## 2. Publish

1. Open the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) and choose the Curbox item, or **New item** for the first upload.
2. On **Package**, upload `curbox-extension-<version>-chrome.zip`.
3. Fill in **Store listing** from section 4 and **Privacy** from section 3. Both tabs must be complete before submitting.
4. On **Distribution**, choose **Public** and all regions.
5. Submit for review. Broad host access (`<all_urls>`) usually means an in depth review, so expect a few days.

## 3. Privacy tab

**Single purpose**

```text
Curbox helps people browse mindfully. It shows how much time they spend on each website and gently limits the sites they choose, through website blocking with schedules and daily limits, focus sessions with a Pomodoro timer, and calm warning screens that ask for a short pause before continuing.
```

**Permission justifications**

| Field | Text |
| --- | --- |
| `storage` | Saves the user's settings, website blocker groups, focus sessions and daily usage totals in chrome.storage.local on their device. Nothing is sent to the developer. |
| `unlimitedStorage` | Users can import block lists and community website packs that hold up to a hundred thousand domains, plus four weeks of usage history. This exceeds the default storage quota, so the lists would otherwise fail to save. |
| `tabs` | Reads the URL of the active tab to count time only on the site the user is actually looking at, and to detect when a tab opens a site the user chose to block. |
| `alarms` | Saves usage at regular intervals and ends focus sessions, Pomodoro breaks and temporary unlocks at the right time, even while the service worker is asleep. |
| `idle` | Pauses time tracking when the user steps away or locks the screen, so idle time is not counted as browsing. |
| `scripting` | Injects the warning screen into tabs that were already open when a block starts or when the extension is first installed, since the declared content script only runs on pages loaded after that. |
| `favicon` | Shows each website's icon next to it in the usage list, read from the browser's own favicon cache. |
| Host permission | The content script shows the warning screen, Gentle Prompts, the grayscale filter and UI hiding on whichever websites the user adds to their rules. Users can pick any site, and rules are matched locally, so the script needs access to all sites. Page content is never read or sent anywhere. Host access also lets the optional Sync feature reach the user's own phone on their local network. |

**Remote code:** No, I am not using Remote code. All JavaScript ships in the package. Imported block lists are plain text lists of domains, read as data and never executed.

**Data usage**

Tick only **Web history**. Leave Personally identifiable information, Health information, Financial and payment information, Authentication information, Personal communications, Location, User activity and Website content unticked. Then tick all three certifications.

Web history is ticked because the optional Sync feature sends daily per site time totals to the user's own paired phone, encrypted, with no developer server in between. Everything else stays on the device.

**Privacy policy URL:** `https://curbox.app/privacy.html` (it must describe Sync before you submit)

## 4. Store listing

| Field | Value |
| --- | --- |
| Name | Curbox (from the manifest) |
| Summary | From the manifest: "A calm companion that helps you stay conscious of your time online." |
| Category | Productivity / Tools |
| Language | English |
| Description | Same as the AMO description: start from the feature sections in `README.md`. Keep dashes out of listing text. |
| Icon | `public/icon/128.png` |
| Screenshots | `docs/store/screenshot-*.png` (1280x800) |
| Small promo tile | `docs/store/promo-small-440x280.png` (required) |
| Marquee promo tile | `docs/store/promo-marquee-1400x560.png` (optional) |

The store images are rendered from `scripts/store-assets/template.html`. After changing the template or the source shots in `docs/screenshots/`, run `node scripts/store-assets/render.mjs` (set `BROWSER` to a Chromium binary if Helium is not installed).
| Official URL | https://curbox.app |
| Homepage URL | https://curbox.app |
| Support URL | https://github.com/curbox-app/curbox-extension/issues |

## 5. Test notes for the reviewer

Paste this into **Test instructions** if the dashboard asks for them:

```text
No account or login is needed. Open the toolbar button. A first run introduction and consent
dialog appear; press I agree. To see a block: Reducers > Website Blocker > add a group with a
site such as example.com and a daily limit of 0 minutes, then visit that site.
Sync (Reducers > Sync) needs the Curbox Android app on a phone on the same WiFi and is optional.
```
