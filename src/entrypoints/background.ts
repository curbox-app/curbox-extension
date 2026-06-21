import { defineBackground, browser } from "#imports";
import { get, watch } from "../lib/storage";
import { todayKey, nowMinutes } from "../lib/time";
import { parseLocation, type SiteLocation } from "../lib/url";
import type { BlockDecision, FocusSession } from "../lib/types";
import type { ContentMessage } from "../lib/messages";
import { sendToTab } from "../lib/messages";
import { evaluate, PASS } from "../core/blocker";
import { activeSession, endSession } from "../core/focus";
import { clearOnOpenGrants, pruneGrants, recordProceed } from "../core/grants";
import { persist, startTracking, stopTracking, setWindowFocused, setPageVisible } from "../core/usage";

let focusedTabId: number | null = null;

async function decide(location: SiteLocation): Promise<BlockDecision> {
  const [settings, usage, grants, proceeds, focus] = await Promise.all([
    get("settings"),
    get("usage"),
    get("grants"),
    get("proceeds"),
    activeSession(),
  ]);
  const now = new Date();
  return evaluate({
    location,
    settings,
    focus,
    todayUsage: usage[todayKey()] ?? {},
    weekday: now.getDay(),
    nowMinutes: nowMinutes(now),
    now: now.getTime(),
    grants,
    proceeds,
  });
}

async function evaluateTab(tabId: number, url: string | undefined, makeActive: boolean): Promise<void> {
  const location = url ? parseLocation(url) : null;
  if (!location) {
    if (makeActive) stopTracking();
    sendToTab(tabId, { type: "evaluate", decision: PASS });
    return;
  }
  const decision = await decide(location);
  sendToTab(tabId, { type: "evaluate", decision });
  if (makeActive) {
    if (decision.blocked) stopTracking();
    else startTracking(tabId, location);
  }
}

async function evaluateFocused(): Promise<void> {
  // The worker can be restarted out from under us, dropping focusedTabId, so
  // recover the active tab before giving up.
  if (focusedTabId == null) {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id == null) return;
    focusedTabId = tab.id;
  }
  try {
    const tab = await browser.tabs.get(focusedTabId);
    await evaluateTab(focusedTabId, tab.url, true);
  } catch {
    focusedTabId = null;
  }
}

async function evaluateAllTabs(): Promise<void> {
  const tabs = await browser.tabs.query({});
  await Promise.all(
    tabs.map((tab) => (tab.id != null ? evaluateTab(tab.id, tab.url, tab.id === focusedTabId) : Promise.resolve())),
  );
}

function scheduleFocusEnd(focus: FocusSession | null): void {
  void browser.alarms.clear("focus-end");
  if (focus) browser.alarms.create("focus-end", { when: focus.endsAt });
}

// Wake exactly when the soonest unlock expires, so the warning returns on time
// instead of waiting on the next tick (or a tab switch).
function scheduleGrantEnd(grants: Record<string, number>): void {
  void browser.alarms.clear("grant-end");
  const now = Date.now();
  const upcoming = Object.values(grants).filter((until) => until > now);
  if (upcoming.length > 0) browser.alarms.create("grant-end", { when: Math.min(...upcoming) });
}

export default defineBackground(() => {
  browser.alarms.create("tick", { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "tick") {
      void persist();
      void evaluateFocused();
    } else if (alarm.name === "focus-end") {
      void activeSession().then(() => evaluateAllTabs());
    } else if (alarm.name === "grant-end") {
      void pruneGrants().then(() => evaluateAllTabs());
    }
  });

  void activeSession().then(scheduleFocusEnd);
  void get("grants").then(scheduleGrantEnd);

  watch((changed) => {
    if ("focus" in changed) {
      scheduleFocusEnd(changed.focus ?? null);
      void evaluateAllTabs();
    }
    if ("settings" in changed) void evaluateAllTabs();
    if ("grants" in changed) scheduleGrantEnd(changed.grants ?? {});
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    focusedTabId = tabId;
    void browser.tabs.get(tabId).then((tab) => evaluateTab(tabId, tab.url, true));
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.url) {
      const location = parseLocation(changeInfo.url);
      if (location) {
        void clearOnOpenGrants(location).then(() => evaluateTab(tabId, tab.url, tabId === focusedTabId));
        return;
      }
    }
    if (changeInfo.status === "complete") {
      void evaluateTab(tabId, tab.url, tabId === focusedTabId);
    }
  });

  browser.windows.onFocusChanged.addListener((windowId) => {
    if (windowId === browser.windows.WINDOW_ID_NONE) {
      setWindowFocused(false);
      return;
    }
    setWindowFocused(true);
    void browser.tabs.query({ active: true, windowId }).then((tabs) => {
      const tab = tabs[0];
      if (tab?.id != null) {
        focusedTabId = tab.id;
        void evaluateTab(tab.id, tab.url, true);
      }
    });
  });

  browser.runtime.onMessage.addListener((message: ContentMessage, sender, sendResponse) => {
    const tabId = sender.tab?.id;
    if (message.type === "visibility") {
      if (tabId != null && tabId === focusedTabId) {
        // The page only reports engaged when its window holds OS focus, so a
        // true here is proof the window is focused. Trust it to heal a focus
        // event the OS may have dropped (onFocusChanged is flaky on macOS).
        if (message.visible) setWindowFocused(true);
        setPageVisible(message.visible);
      }
      return;
    }
    if (message.type === "navigated") {
      if (tabId != null) {
        const location = parseLocation(message.url);
        const after = location ? clearOnOpenGrants(location) : Promise.resolve();
        void after.then(() => evaluateTab(tabId, message.url, tabId === focusedTabId));
      }
      return;
    }
    if (message.type === "endFocus") {
      void endSession();
      return;
    }
    if (message.type === "proceed") {
      void recordProceed(message.groupId, message.minutes).then(() => {
        if (tabId != null) void evaluateTab(tabId, sender.tab?.url, tabId === focusedTabId);
        sendResponse(true);
      });
      return true;
    }
  });
});
