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
import {
  persist,
  startTracking,
  stopTracking,
  setWindowFocused,
  setPageVisible,
  setMachineState,
  setTabAudible,
} from "../core/usage";
import { getSyncEngine } from "../lib/sync/engine";
import { isSyncRequest, type SyncRequest, type SyncResponse } from "../lib/sync/types";

let focusedTabId: number | null = null;

const sync = getSyncEngine();

async function handleSync(req: SyncRequest): Promise<SyncResponse> {
  try {
    switch (req.type) {
      case "sync:signUp":
        await sync.signUp(req.email, req.password);
        break;
      case "sync:signIn":
        await sync.signIn(req.email, req.password);
        break;
      case "sync:verifyCode":
        await sync.verifyCode(req.email, req.code);
        break;
      case "sync:resendCode":
        await sync.resendCode(req.email);
        break;
      case "sync:sendReset":
        await sync.sendReset(req.email);
        break;
      case "sync:resetPassword":
        await sync.resetPassword(req.email, req.code, req.password);
        break;
      case "sync:signOut":
        await sync.signOut();
        break;
      case "sync:setPassphrase":
        await sync.setPassphrase(req.passphrase);
        break;
      case "sync:unlock":
        await sync.unlock(req.passphrase);
        break;
      case "sync:makePairingCode":
        return { ok: true, pairingCode: await sync.makePairingCode(), status: await sync.status() };
      case "sync:pairWithCode":
        await sync.pairWithCode(req.payload);
        break;
      case "sync:setDeviceName":
        await sync.setDeviceName(req.name);
        break;
      case "sync:setPreferences":
        await sync.setPreferences(req.preferences);
        break;
      case "sync:status":
        break;
    }
    return { ok: true, status: await sync.status() };
  } catch (err) {
    return { ok: false, error: friendlyError(err), status: await sync.status() };
  }
}

function friendlyError(err: unknown): string {
  const raw = String((err as Error)?.message ?? err ?? "");
  const m = raw.toLowerCase();
  if (m.includes("invalid login") || (m.includes("invalid") && m.includes("credential")))
    return "That email or password did not match. Please try again.";
  if (m.includes("already registered") || m.includes("already been registered"))
    return "You already have an account with this email. Please sign in instead.";
  if (m.includes("email not confirmed")) return "Please confirm your email first. I can send you a new code.";
  if (m.includes("token has expired") || m.includes("otp") || (m.includes("invalid") && m.includes("code")))
    return "That code did not work. Check it or ask me for a new one.";
  if (m.includes("for security purposes") || m.includes("rate limit") || m.includes("too many"))
    return "Please wait a moment, then try again.";
  if (m.includes("password should be") || (m.includes("at least") && m.includes("character")))
    return "Please use a password with at least 6 letters or numbers.";
  if (m.includes("failed to fetch") || m.includes("network") || m.includes("timeout") || m.includes("offline"))
    return "I cannot reach the internet right now. Check your connection and try again.";
  return raw || "Something went wrong. Please try again.";
}

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
  // The decision is async: if focus moved to another tab meanwhile, a newer
  // evaluation owns the tracker and this stale one must not steal it back.
  if (makeActive && tabId === focusedTabId) {
    if (decision.blocked) void stopTracking();
    else void startTracking(tabId, location);
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
    void setTabAudible(tab.audible === true);
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

// The OS tells us directly when the machine goes idle or the screen locks (lid
// close, walking away, sleep). The tracker stops the clock on anything but
// "active", unless the tab is audibly playing, which proves passive use.
function applyIdleState(state: "active" | "idle" | "locked"): void {
  void setMachineState(state);
}

export default defineBackground(() => {
  void sync.start();

  // Smallest interval the API allows, so a closed lid stops counting promptly.
  browser.idle.setDetectionInterval(15);
  browser.idle.onStateChanged.addListener(applyIdleState);
  void browser.idle.queryState(15).then(applyIdleState);

  browser.alarms.create("tick", { periodInMinutes: 0.5 });
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "tick") {
      // Re-query heals any state change the worker missed while it was asleep.
      void browser.idle.queryState(15).then(applyIdleState);
      void get("termsAccepted").then((accepted) => {
        if (!accepted) return;
        void persist();
        void evaluateFocused();
      });
      void sync.pullSinceCursor();
    } else if (alarm.name === "focus-end") {
      void activeSession().then(() => evaluateAllTabs());
    } else if (alarm.name === "grant-end") {
      void pruneGrants().then(() => evaluateAllTabs());
    }
  });

  void activeSession().then(scheduleFocusEnd);
  void get("grants").then(scheduleGrantEnd);

  // On worker start, only begin tracking if the user has accepted the terms.
  // If not yet accepted, the watch handler below starts tracking once they do.
  void get("termsAccepted").then((accepted) => {
    if (!accepted) return;
    void browser.windows
      .getLastFocused()
      .then((win) => setWindowFocused(win.focused === true))
      .catch(() => {});
    void evaluateFocused();
  });

  watch((changed) => {
    if ("termsAccepted" in changed && changed.termsAccepted) {
      void browser.windows
        .getLastFocused()
        .then((win) => setWindowFocused(win.focused === true))
        .catch(() => {});
      void evaluateFocused();
    }
    if ("focus" in changed) {
      scheduleFocusEnd(changed.focus ?? null);
      void evaluateAllTabs();
    }
    if ("settings" in changed) void evaluateAllTabs();
    if ("grants" in changed) scheduleGrantEnd(changed.grants ?? {});
  });

  browser.tabs.onActivated.addListener(({ tabId }) => {
    focusedTabId = tabId;
    void browser.tabs.get(tabId).then((tab) => {
      void setTabAudible(tab.audible === true);
      return evaluateTab(tabId, tab.url, true);
    });
  });

  browser.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    if (changeInfo.audible !== undefined && tabId === focusedTabId) {
      void setTabAudible(changeInfo.audible);
    }
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
        void setTabAudible(tab.audible === true);
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

  browser.runtime.onMessage.addListener((message: unknown, _sender, sendResponse) => {
    if (!isSyncRequest(message)) return;
    void handleSync(message).then(sendResponse);
    return true;
  });
});
