import { defineBackground, browser } from "#imports";
import { get, watch } from "../lib/storage";
import { parseLocation, type SiteLocation } from "../lib/url";
import type { BlockDecision, FocusSession } from "../lib/types";
import type { ContentMessage, PromptReply } from "../lib/messages";
import { sendToTab } from "../lib/messages";
import { evaluate, PASS } from "../core/blocker";
import { activeSession, endSession } from "../core/focus";
import { clearExitedOnOpenGrants, pruneGrants, recordProceed } from "../core/grants";
import { noteOpen } from "../core/opens";
import { compiledLists, reconcileLists } from "../core/lists";
import { groupMatches } from "../lib/match";
import { promptValues } from "../lib/prompt";
import { mergeUsage } from "../lib/usage-data";
import {
  persist,
  startTracking,
  stopTracking,
  setWindowFocused,
  setPageVisible,
  setMachineState,
  setTabAudible,
  liveDeltas,
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
      case "sync:syncNow":
        await sync.syncNow();
        break;
      case "sync:subscribe": {
        const url = await sync.billingUrl("checkout");
        await browser.tabs.create({ url });
        break;
      }
      case "sync:manageSubscription": {
        const url = await sync.billingUrl("manage");
        await browser.tabs.create({ url });
        break;
      }
      case "sync:refreshEntitlement":
        await sync.refreshEntitlement();
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
  const [settings, usage, grants, proceeds, focus, focusLog, lists] = await Promise.all([
    get("settings"),
    get("usage"),
    get("grants"),
    get("proceeds"),
    activeSession(),
    get("focusLog"),
    compiledLists(),
  ]);
  const now = Date.now();
  return evaluate({
    location,
    settings,
    focus,
    usage,
    focusLog,
    now,
    grants,
    proceeds,
    lists,
  });
}

async function evaluateTab(tabId: number, url: string | undefined, makeActive: boolean): Promise<void> {
  const location = url ? parseLocation(url) : null;
  if (makeActive) await clearExitedOnOpenGrants(location);
  if (!location) {
    if (makeActive) {
      stopTracking();
      void noteOpen(null);
    }
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
    void noteOpen(decision.blocked ? null : location.domain);
  }
}

async function gentlePrompt(url: string): Promise<PromptReply> {
  const location = parseLocation(url);
  const settings = await get("settings");
  const config = settings.gentlePrompt;
  if (!location || !config.enabled || !groupMatches(location, config.sites)) return null;
  const [usage, deltas, opens, lists] = await Promise.all([get("usage"), liveDeltas(), get("opens"), compiledLists()]);
  return { config, values: promptValues(location.domain, mergeUsage(usage, deltas), opens, settings, Date.now(), lists) };
}

function supportsWindows(): boolean {
  try {
    return typeof browser.windows?.getLastFocused === "function" && typeof browser.windows?.create === "function";
  } catch {
    return false;
  }
}

async function queryActiveTab(): Promise<{ id?: number; url?: string; audible?: boolean } | undefined> {
  // lastFocusedWindow is the desktop query. Firefox Android rejects it because
  // there is no windows API, so only use it where that API exists.
  if (supportsWindows()) {
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    return tab;
  }
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    if (tab?.id != null) return tab;
  } catch {
    // currentWindow is also a window-model filter.
  }
  const [tab] = await browser.tabs.query({ active: true });
  return tab;
}

async function evaluateFocused(): Promise<void> {
  // The worker can be restarted out from under us, dropping focusedTabId, so
  // recover the active tab before giving up.
  if (focusedTabId == null) {
    const tab = await queryActiveTab();
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

const PANEL_WIDTH = 480;
const PANEL_HEIGHT = 960;

type ToolbarAction = { onClicked: { addListener: (cb: () => void) => void } };

function toolbarAction(): ToolbarAction | undefined {
  const api = browser as typeof browser & { action?: ToolbarAction; browserAction?: ToolbarAction };
  return api.action ?? api.browserAction;
}

async function openDesktopPanel(url: string): Promise<void> {
  const open = await browser.windows.getAll({ populate: true, windowTypes: ["popup"] });
  const existing = open.find((win) => win.tabs?.some((tab) => tab.url?.startsWith(url)));
  if (existing?.id != null) {
    await browser.windows.update(existing.id, { focused: true });
    return;
  }

  const current = await browser.windows.getCurrent();
  const available = Math.max(640, (current.height ?? PANEL_HEIGHT) - 24);
  const height = Math.min(PANEL_HEIGHT, available);
  const top = Math.max(0, (current.top ?? 0) + 48);
  const left = Math.max(0, (current.left ?? 0) + (current.width ?? PANEL_WIDTH) - PANEL_WIDTH - 12);
  await browser.windows.create({
    url,
    type: "popup",
    width: PANEL_WIDTH,
    height,
    top,
    left,
    focused: true,
  });
}

async function openAppTab(url: string): Promise<void> {
  const tabs = await browser.tabs.query({});
  const existing = tabs.find((tab) => tab.url?.startsWith(url));
  if (existing?.id != null) {
    await browser.tabs.update(existing.id, { active: true });
    return;
  }
  await browser.tabs.create({ url });
}

async function openAppWindow(): Promise<void> {
  const panelUrl = browser.runtime.getURL("/panel.html");
  if (supportsWindows()) {
    try {
      await openDesktopPanel(panelUrl);
      return;
    } catch {
      // Popup windows are a desktop API. Fall through to a tab.
    }
  }
  // options.html is the same app in page layout, which a phone tab can show.
  await openAppTab(browser.runtime.getURL("/options.html"));
}

function watchIdle(): void {
  const idle = browser.idle;
  if (!idle?.setDetectionInterval || !idle.onStateChanged || !idle.queryState) return;
  try {
    idle.setDetectionInterval(15);
    idle.onStateChanged.addListener(applyIdleState);
    void idle.queryState(15).then(applyIdleState).catch(() => undefined);
  } catch {
    // Firefox Android does not implement idle. Page visibility still stops the clock.
  }
}

function refreshIdle(): void {
  if (!browser.idle?.queryState) return;
  void browser.idle.queryState(15).then(applyIdleState).catch(() => undefined);
}

function syncWindowFocus(): void {
  if (!browser.windows?.getLastFocused) return;
  void browser.windows
    .getLastFocused()
    .then((win) => setWindowFocused(win.focused === true))
    .catch(() => undefined);
}

function watchWindowFocus(): void {
  if (!browser.windows?.onFocusChanged) return;
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
}

function startTickAlarm(): void {
  try {
    const created = browser.alarms.create("tick", { periodInMinutes: 0.5 }) as unknown;
    if (created && typeof (created as Promise<void>).then === "function") {
      void (created as Promise<void>).catch(() => browser.alarms.create("tick", { periodInMinutes: 1 }));
    }
  } catch {
    void browser.alarms.create("tick", { periodInMinutes: 1 });
  }
}

export default defineBackground(() => {
  toolbarAction()?.onClicked.addListener(() => {
    void openAppWindow();
  });

  // Call registerSyncProvider before this when a remote sync service is connected.
  void sync.start().catch(() => undefined);

  // Smallest interval the API allows, so a closed lid stops counting promptly.
  // Missing on Firefox Android; skipping it must not abort the rest of startup.
  watchIdle();

  startTickAlarm();
  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === "tick") {
      // Re-query heals any state change the worker missed while it was asleep.
      refreshIdle();
      void get("termsAccepted").then((accepted) => {
        if (!accepted) return;
        void persist();
        void evaluateFocused();
      });
      void sync.pullSinceCursor().catch(() => undefined);
    } else if (alarm.name === "focus-end") {
      void activeSession().then(() => evaluateAllTabs());
    } else if (alarm.name === "grant-end") {
      void pruneGrants().then(() => evaluateAllTabs());
    }
  });

  void activeSession().then(scheduleFocusEnd);
  void get("settings").then(reconcileLists);
  void get("grants").then(scheduleGrantEnd);

  // On worker start, only begin tracking if the user has accepted the terms.
  // If not yet accepted, the watch handler below starts tracking once they do.
  void get("termsAccepted").then((accepted) => {
    if (!accepted) return;
    syncWindowFocus();
    void evaluateFocused();
  });

  watch((changed) => {
    if ("termsAccepted" in changed && changed.termsAccepted) {
      syncWindowFocus();
      void evaluateFocused();
    }
    if ("focus" in changed) {
      scheduleFocusEnd(changed.focus ?? null);
      void evaluateAllTabs();
    }
    if ("focusLog" in changed) void evaluateAllTabs();
    if ("settings" in changed) {
      void evaluateAllTabs();
      if (changed.settings) void reconcileLists(changed.settings);
    }
    if ("wordLists" in changed) void evaluateAllTabs();
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
      void evaluateTab(tabId, tab.url, tabId === focusedTabId);
      return;
    }
    if (changeInfo.status === "complete" && tab.url) {
      void evaluateTab(tabId, tab.url, tabId === focusedTabId);
    }
  });

  watchWindowFocus();

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
        void evaluateTab(tabId, message.url, tabId === focusedTabId);
      }
      return;
    }
    if (message.type === "endFocus") {
      void endSession();
      return;
    }
    if (message.type === "prompt") {
      void gentlePrompt(message.url).then(sendResponse);
      return true;
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
