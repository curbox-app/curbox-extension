import type { ContentScriptContext } from "#imports";
import { PATH_ATTR, rulesForSite, type HiderRule } from "../lib/ui-hider";
import { parseLocation } from "../lib/url";
import type { SettingsFeed } from "./settings";
import { injectStyle } from "./dom";

const STYLE_ID = "curbox-ui-hider";

// Plain CSS, injected before the page paints, so hidden parts never flash in.
export function createUiHider(ctx: ContentScriptContext, feed: SettingsFeed): { refresh: () => void } {
  const domain = parseLocation(location.href)?.domain;
  const siteRules = domain ? rulesForSite(domain) : [];
  if (siteRules.length === 0) return { refresh: () => {} };

  let rules: HiderRule[] = [];
  let timer: number | null = null;

  const tick = () => {
    const root = document.documentElement;
    if (root && root.getAttribute(PATH_ATTR) !== location.pathname) root.setAttribute(PATH_ATTR, location.pathname);
    for (const rule of rules) rule.run?.();
  };

  // Navigation events cover most path changes, but the page builds its DOM
  // late, so poll gently while a rule is on and the page is on screen.
  const schedule = () => {
    const want = rules.length > 0 && document.visibilityState === "visible";
    if (want && timer === null) timer = ctx.setInterval(tick, 500);
    else if (!want && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  };

  async function apply(): Promise<void> {
    const enabled = (await feed.current()).hiddenElements;
    rules = siteRules.filter((rule) => enabled.includes(rule.id));
    injectStyle(STYLE_ID, rules.map((rule) => rule.css).join("\n"));
    tick();
    schedule();
  }

  ctx.addEventListener(document, "visibilitychange", schedule);
  ctx.onInvalidated(() => injectStyle(STYLE_ID, ""));
  feed.subscribe(() => void apply());
  tick();
  void apply();

  return { refresh: tick };
}
