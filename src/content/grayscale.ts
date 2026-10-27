import { get, watch } from "../lib/storage";
import { shouldGrayscale } from "../core/grayscale";
import { parseLocation } from "../lib/url";

const STYLE_ID = "curbox-grayscale";
const CSS = `html { filter: grayscale(1) !important; transition: filter 0.6s cubic-bezier(0.22, 0.61, 0.36, 1); }
@media (prefers-reduced-motion: reduce) { html { transition: none; } }`;

// Runs in the page itself, so a gray site is gray from the first paint instead
// of flashing color while the worker wakes up.
export function createGrayscale(): { refresh: () => void } {
  let timer: ReturnType<typeof setTimeout> | null = null;

  function apply(on: boolean): void {
    const existing = document.getElementById(STYLE_ID);
    if (on && !existing) {
      const style = document.createElement("style");
      style.id = STYLE_ID;
      style.textContent = CSS;
      (document.head || document.documentElement).appendChild(style);
    } else if (!on) existing?.remove();
  }

  async function refresh(): Promise<void> {
    const loc = parseLocation(location.href);
    const settings = await get("settings");
    apply(!!loc && shouldGrayscale(loc, settings));
    // Recheck on the next minute so schedules start and stop on time.
    if (timer) clearTimeout(timer);
    timer = settings.grayscaleGroups.some((group) => group.enabled)
      ? setTimeout(() => void refresh(), 60_000 - (Date.now() % 60_000))
      : null;
  }

  watch((changed) => {
    if ("settings" in changed) void refresh();
  });
  void refresh();

  return { refresh: () => void refresh() };
}
