import { browser } from "#imports";
import type { BlockDecision } from "./types";

export type ContentMessage =
  | { type: "visibility"; visible: boolean }
  | { type: "navigated"; url: string }
  | { type: "proceed"; groupId: string; domain: string; minutes?: number }
  | { type: "endFocus" };

export type BgMessage = { type: "evaluate"; decision: BlockDecision };

export function sendToBackground<R = unknown>(msg: ContentMessage): Promise<R> {
  return browser.runtime.sendMessage(msg) as Promise<R>;
}

export function sendToTab(tabId: number, msg: BgMessage): void {
  browser.tabs.sendMessage(tabId, msg).catch(() => {
    // Nobody answered: the tab was open before the extension loaded (or the
    // worker reloaded and orphaned its content script), so a focus session or
    // block that starts while sitting on the page never reaches it. Inject the
    // script and deliver once. Only worth doing for a real block; a "pass" to a
    // script-less tab has nothing to show.
    if (!msg.decision.blocked) return;
    browser.scripting
      .executeScript({ target: { tabId }, files: ["/content-scripts/content.js"] })
      .then(() => browser.tabs.sendMessage(tabId, msg))
      .catch(() => {});
  });
}
