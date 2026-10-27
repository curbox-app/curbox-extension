import { browser } from "#imports";
import type { PromptValues } from "./prompt";
import type { BlockDecision, GentlePromptConfig } from "./types";

export type ContentMessage =
  | { type: "visibility"; visible: boolean }
  | { type: "navigated"; url: string }
  | { type: "proceed"; groupId: string; domain: string; minutes?: number }
  | { type: "endFocus" }
  | { type: "prompt"; url: string };

export type PromptReply = { config: GentlePromptConfig; values: PromptValues } | null;

export type BgMessage = { type: "evaluate"; decision: BlockDecision };

export function sendToBackground<R = unknown>(msg: ContentMessage): Promise<R> {
  return browser.runtime.sendMessage(msg) as Promise<R>;
}

const CONTENT_FILE = "/content-scripts/content.js";

type LegacyTabInjector = {
  executeScript?: (tabId: number, details: { file: string }) => Promise<unknown>;
};

function injectContentScript(tabId: number): Promise<unknown> {
  const legacy = (browser.tabs as typeof browser.tabs & LegacyTabInjector).executeScript?.bind(browser.tabs);
  const runLegacy = () => (legacy ? legacy(tabId, { file: CONTENT_FILE }) : Promise.reject(new Error("unavailable")));
  // Chromium and desktop Firefox use scripting. Firefox for Android often only
  // has the MV2 tabs.executeScript entry, so fall back when scripting is missing
  // or rejects. A successful scripting call never reaches the fallback.
  if (typeof browser.scripting?.executeScript !== "function") return runLegacy();
  return browser.scripting.executeScript({ target: { tabId }, files: [CONTENT_FILE] }).catch(() => runLegacy());
}

export function sendToTab(tabId: number, msg: BgMessage): void {
  browser.tabs.sendMessage(tabId, msg).catch(() => {
    // Nobody answered: the tab was open before the extension loaded (or the
    // worker reloaded and orphaned its content script), so a focus session or
    // block that starts while sitting on the page never reaches it. Inject the
    // script and deliver once. Only worth doing for a real block; a "pass" to a
    // script-less tab has nothing to show.
    if (!msg.decision.blocked) return;
    void injectContentScript(tabId)
      .then(() => browser.tabs.sendMessage(tabId, msg))
      .catch(() => {});
  });
}
