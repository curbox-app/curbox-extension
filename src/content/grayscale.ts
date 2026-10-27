import type { ContentScriptContext } from "#imports";
import { shouldGrayscale } from "../core/grayscale";
import { parseLocation } from "../lib/url";
import type { SettingsFeed } from "./settings";
import { injectStyle } from "./dom";

const STYLE_ID = "curbox-grayscale";
const CSS = `html { filter: grayscale(1) !important; transition: filter 0.6s cubic-bezier(0.22, 0.61, 0.36, 1); }
@media (prefers-reduced-motion: reduce) { html { transition: none; } }`;

// Runs in the page itself, so a gray site is gray from the first paint instead
// of flashing color while the worker wakes up.
export function createGrayscale(ctx: ContentScriptContext, feed: SettingsFeed): { refresh: () => void } {
  let timer: number | null = null;

  async function refresh(): Promise<void> {
    const settings = await feed.current();
    const loc = parseLocation(location.href);
    injectStyle(STYLE_ID, !!loc && shouldGrayscale(loc, settings) ? CSS : "");
    // Recheck on the next minute so schedules start and stop on time.
    if (timer) clearTimeout(timer);
    timer = settings.grayscaleGroups.some((group) => group.enabled)
      ? ctx.setTimeout(() => void refresh(), 60_000 - (Date.now() % 60_000))
      : null;
  }

  ctx.onInvalidated(() => injectStyle(STYLE_ID, ""));
  feed.subscribe(() => void refresh());
  void refresh();

  return { refresh: () => void refresh() };
}
