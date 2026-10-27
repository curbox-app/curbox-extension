import { get, watch } from "../lib/storage";
import { PATH_ATTR, rulesForSite, type HiderRule } from "../lib/ui-hider";
import { parseLocation } from "../lib/url";

const STYLE_ID = "curbox-ui-hider";

// Plain CSS, injected before the page paints, so hidden parts never flash in.
export function createUiHider(): void {
  const domain = parseLocation(location.href)?.domain;
  const siteRules = domain ? rulesForSite(domain) : [];
  if (siteRules.length === 0) return;

  let rules: HiderRule[] = [];

  async function apply(): Promise<void> {
    const enabled = (await get("settings")).hiddenElements;
    rules = siteRules.filter((rule) => enabled.includes(rule.id));
    let style = document.getElementById(STYLE_ID);
    if (rules.length === 0) return style?.remove();
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = rules.map((rule) => rule.css).join("\n");
  }

  // These sites navigate without reloading, and the page's own history calls
  // are invisible from this isolated script, so watch the path directly.
  const tick = () => {
    if (document.documentElement.getAttribute(PATH_ATTR) !== location.pathname) {
      document.documentElement.setAttribute(PATH_ATTR, location.pathname);
    }
    for (const rule of rules) rule.run?.();
  };
  tick();
  setInterval(tick, 500);

  watch((changed) => {
    if ("settings" in changed) void apply();
  });
  void apply();
}
