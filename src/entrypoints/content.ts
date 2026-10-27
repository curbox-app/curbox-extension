import { defineContentScript, browser } from "#imports";
import { sendToBackground } from "../lib/messages";
import type { BgMessage } from "../lib/messages";
import type { BlockDecision } from "../lib/types";
import { parseLocation } from "../lib/url";
import { createOverlay } from "../content/overlay";
import { createPrompt } from "../content/prompt";
import { createGrayscale } from "../content/grayscale";
import { createUiHider } from "../content/ui-hider";
import { createSettingsFeed } from "../content/settings";

type NavigationTarget = { addEventListener: EventTarget["addEventListener"] };

export default defineContentScript({
  matches: ["<all_urls>"],
  runAt: "document_start",
  main(ctx) {
    // We also inject this script on demand (see sendToTab) to reach tabs that
    // predate the extension. WXT invalidates any older copy when a new one
    // starts, so each feature cleans up after itself on invalidation.
    const feed = createSettingsFeed();
    const overlay = createOverlay();
    const prompt = createPrompt(ctx, feed);
    const grayscale = createGrayscale(ctx, feed);
    const hider = createUiHider(ctx, feed);
    ctx.onInvalidated(overlay.hide);

    // The first report rides along with the verdict request below; after that
    // only real changes wake the worker.
    const isEngaged = () => document.visibilityState === "visible" && document.hasFocus();
    let engaged: boolean | null = isEngaged();
    const reportEngagement = () => {
      const next = isEngaged();
      if (next === engaged || ctx.isInvalid) return;
      engaged = next;
      sendToBackground({ type: "visibility", visible: next }).catch(() => (engaged = null));
    };
    ctx.addEventListener(document, "visibilitychange", reportEngagement);
    ctx.addEventListener(window, "focus", reportEngagement);
    ctx.addEventListener(window, "blur", reportEngagement);

    const leave = () => {
      if (history.length > 1) history.back();
      else location.replace("about:blank");
    };

    const apply = (decision: BlockDecision) => {
      if (!decision.blocked) return overlay.hide();
      overlay.show(decision, {
        onProceed: (minutes) => {
          const domain = parseLocation(location.href)?.domain;
          if (domain) void sendToBackground({ type: "proceed", groupId: decision.groupId, domain, minutes });
        },
        onLeave: leave,
        onEndFocus: () => void sendToBackground({ type: "endFocus" }),
      });
    };

    // Page history calls are invisible from this isolated world, so follow the
    // URL through the Navigation API where it exists, and through every message
    // the worker sends after it sees the tab's URL change.
    let href = location.href;
    const followLocation = () => {
      if (location.href === href) return;
      href = location.href;
      prompt.refresh();
      grayscale.refresh();
      hider.refresh();
    };
    const navigation = (globalThis as { navigation?: NavigationTarget }).navigation;
    if (navigation) ctx.addEventListener(navigation as unknown as Window, "navigatesuccess", followLocation);
    ctx.addEventListener(window, "popstate", followLocation);

    const onMessage = (message: BgMessage) => {
      followLocation();
      if (message.type === "settings") feed.push(message.settings);
      else if (message.type === "evaluate") apply(message.decision);
    };
    browser.runtime.onMessage.addListener(onMessage);
    ctx.onInvalidated(() => browser.runtime.onMessage.removeListener(onMessage));

    // Ask for the verdict right away, so a blocked page is covered before it
    // paints instead of after it finishes loading.
    sendToBackground<BlockDecision | null>({ type: "navigated", url: location.href, visible: !!engaged })
      .then((decision) => decision && !ctx.isInvalid && apply(decision))
      .catch(() => (engaged = null));
  },
});
