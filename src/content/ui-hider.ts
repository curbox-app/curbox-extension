import { get, watch } from "../lib/storage";
import { HOME_ATTR, rulesForSite } from "../lib/ui-hider";
import { parseLocation } from "../lib/url";

const STYLE_ID = "curbox-ui-hider";

// Plain CSS, injected before the page paints, so hidden parts never flash in.
export function createUiHider(): void {
  const domain = parseLocation(location.href)?.domain;
  const siteRules = domain ? rulesForSite(domain) : [];
  if (siteRules.length === 0) return;

  async function apply(): Promise<void> {
    const enabled = (await get("settings")).hiddenElements;
    const rules = siteRules.filter((rule) => enabled.includes(rule.id));
    let style = document.getElementById(STYLE_ID);
    if (rules.length === 0) return style?.remove();
    if (!style) {
      style = document.createElement("style");
      style.id = STYLE_ID;
      (document.head || document.documentElement).appendChild(style);
    }
    style.textContent = rules.map((rule) => rule.css).join("\n");
  }

  // YouTube navigates without reloading, and the page's own history calls are
  // invisible from this isolated script, so watch the path directly.
  let path = "";
  const markHome = () => {
    if (location.pathname === path) return;
    path = location.pathname;
    document.documentElement.toggleAttribute(HOME_ATTR, path === "/");
  };
  markHome();
  setInterval(markHome, 500);

  watch((changed) => {
    if ("settings" in changed) void apply();
  });
  void apply();
}
