import { defineContentScript, browser } from "#imports";
import { sendToBackground } from "../lib/messages";
import type { BgMessage } from "../lib/messages";
import { parseLocation } from "../lib/url";
import { createOverlay } from "../content/overlay";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    // We also inject this script on demand (see sendToTab) to reach tabs that
    // predate the extension. Guard so a page that already has it never runs
    // twice and stacks two overlays.
    const marker = "__curboxContentLoaded";
    if ((window as unknown as Record<string, boolean>)[marker]) return;
    (window as unknown as Record<string, boolean>)[marker] = true;

    const overlay = createOverlay();

    const reportEngagement = () => {
      const engaged = document.visibilityState === "visible" && document.hasFocus();
      void sendToBackground({ type: "visibility", visible: engaged });
    };
    document.addEventListener("visibilitychange", reportEngagement);
    window.addEventListener("focus", reportEngagement);
    window.addEventListener("blur", reportEngagement);
    reportEngagement();

    const reportNavigation = () => {
      void sendToBackground({ type: "navigated", url: location.href });
    };
    hookHistory(reportNavigation);
    window.addEventListener("popstate", reportNavigation);

    const leave = () => {
      if (history.length > 1) history.back();
      else location.replace("about:blank");
    };

    browser.runtime.onMessage.addListener((message: BgMessage) => {
      if (message.type !== "evaluate") return;
      if (message.decision.blocked) {
        overlay.show(message.decision, {
          onProceed: (minutes) => {
            const domain = parseLocation(location.href)?.domain;
            if (domain) void sendToBackground({ type: "proceed", groupId: message.decision.groupId, domain, minutes });
          },
          onLeave: leave,
          onEndFocus: () => void sendToBackground({ type: "endFocus" }),
        });
      } else {
        overlay.hide();
      }
    });
  },
});

function hookHistory(onChange: () => void) {
  const wrap = (fn: typeof history.pushState) =>
    function (this: History, ...args: Parameters<typeof history.pushState>) {
      const result = fn.apply(this, args);
      onChange();
      return result;
    };
  history.pushState = wrap(history.pushState);
  history.replaceState = wrap(history.replaceState);
}
