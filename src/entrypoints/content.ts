import { defineContentScript, browser } from "#imports";
import { sendToBackground } from "../lib/messages";
import type { BgMessage } from "../lib/messages";
import { parseLocation } from "../lib/url";
import { createOverlay } from "../content/overlay";

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main() {
    const overlay = createOverlay();

    const reportVisibility = () => {
      void sendToBackground({ type: "visibility", visible: document.visibilityState === "visible" });
    };
    document.addEventListener("visibilitychange", reportVisibility);
    reportVisibility();

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
          onProceed: () => {
            const domain = parseLocation(location.href)?.domain;
            if (domain) void sendToBackground({ type: "proceed", groupId: message.decision.groupId, domain });
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
