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
  browser.tabs.sendMessage(tabId, msg).catch(() => {});
}
