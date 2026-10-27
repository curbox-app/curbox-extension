import { useEffect, useState } from "react";
import { browser } from "#imports";
import { get, getUsage, isUsageKey, set, usageDay, watch, DEFAULT_SETTINGS } from "../lib/storage";
import { mergeUsage } from "../lib/sync/merge";
import { lastNDays } from "../lib/time";
import { RETENTION_DAYS } from "../lib/usage-data";
import type { DayUsage, FocusLogEntry, FocusSession, Settings, UsageHistory } from "../lib/types";

const REMOTE_USAGE_KEY = "sync.remoteUsageView";
const WATCHED = new Set(["settings", "focus", "focusLog", "termsAccepted", REMOTE_USAGE_KEY]);

async function loadRemoteUsage(): Promise<UsageHistory> {
  const res = await browser.storage.local.get(REMOTE_USAGE_KEY);
  return (res[REMOTE_USAGE_KEY] as UsageHistory | undefined) ?? {};
}

export interface CurboxState {
  usage: UsageHistory;
  settings: Settings;
  focus: FocusSession | null;
  focusLog: FocusLogEntry[];
  termsAccepted: boolean;
  ready: boolean;
}

export function useCurbox() {
  const [state, setState] = useState<CurboxState>({
    usage: {},
    settings: DEFAULT_SETTINGS,
    focus: null,
    focusLog: [],
    termsAccepted: false,
    ready: false,
  });

  useEffect(() => {
    let alive = true;
    let localUsage: UsageHistory = {};
    let remoteUsage: UsageHistory = {};

    const load = async () => {
      const [usage, settings, focus, focusLog, termsAccepted, remote] = await Promise.all([
        getUsage(lastNDays(RETENTION_DAYS + 1)),
        get("settings"),
        get("focus"),
        get("focusLog"),
        get("termsAccepted"),
        loadRemoteUsage(),
      ]);
      // Days written while loading arrive through the watcher; keep the newer copy.
      localUsage = { ...usage, ...localUsage };
      remoteUsage = remote;
      if (alive) setState({ usage: mergeUsage(localUsage, remoteUsage), settings, focus, focusLog, termsAccepted, ready: true });
    };
    void load();
    const stop = watch((changed) => {
      const keys = Object.keys(changed);
      const usageKeys = keys.filter(isUsageKey);
      if (usageKeys.length === 0 && !keys.some((key) => WATCHED.has(key))) return;
      if (usageKeys.length > 0) {
        localUsage = { ...localUsage };
        for (const key of usageKeys) {
          const day = changed[key] as DayUsage | undefined;
          if (day) localUsage[usageDay(key)] = day;
          else delete localUsage[usageDay(key)];
        }
      }
      if (REMOTE_USAGE_KEY in changed) {
        remoteUsage = (changed[REMOTE_USAGE_KEY] as UsageHistory | undefined) ?? {};
      }
      setState((prev) => ({
        usage: usageKeys.length > 0 || REMOTE_USAGE_KEY in changed ? mergeUsage(localUsage, remoteUsage) : prev.usage,
        settings: changed.settings ?? prev.settings,
        focus: "focus" in changed ? (changed.focus ?? null) : prev.focus,
        focusLog: changed.focusLog ?? prev.focusLog,
        termsAccepted: changed.termsAccepted ?? prev.termsAccepted,
        ready: prev.ready,
      }));
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const saveSettings = (settings: Settings) => set("settings", settings);
  const acceptTerms = () => set("termsAccepted", true);

  return { ...state, saveSettings, acceptTerms };
}
