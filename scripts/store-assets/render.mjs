// Renders store screenshots and promo tiles from template.html into docs/store/.
// Usage: node scripts/store-assets/render.mjs  (set BROWSER to use another Chromium)
import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = resolve(here, "../../docs/store");
const template = pathToFileURL(resolve(here, "template.html")).href;
const browser = process.env.BROWSER ?? "/Applications/Helium.app/Contents/MacOS/Helium";

const jobs = [
  ...["usage", "warning", "focus-setup", "focus", "reducers"].map((kind, i) => ({
    kind,
    file: `screenshot-${i + 1}-${kind}.png`,
    size: [1280, 800],
  })),
  { kind: "small", file: "promo-small-440x280.png", size: [440, 280] },
  { kind: "marquee", file: "promo-marquee-1400x560.png", size: [1400, 560] },
];

mkdirSync(out, { recursive: true });
for (const { kind, file, size } of jobs) {
  execFileSync(browser, [
    "--headless",
    "--disable-gpu",
    "--hide-scrollbars",
    "--allow-file-access-from-files",
    "--force-device-scale-factor=1",
    "--virtual-time-budget=8000",
    `--window-size=${size.join(",")}`,
    `--screenshot=${resolve(out, file)}`,
    `${template}?kind=${kind}`,
  ], { stdio: "ignore" });
  console.log(`docs/store/${file}`);
}
