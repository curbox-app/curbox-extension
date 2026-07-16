import { useEffect, useState } from "react";
import { browser } from "#imports";
import { get, set, watch, DEFAULT_SETTINGS } from "../lib/storage";
import { mergeUsage } from "../lib/sync/merge";
import type { FocusLogEntry, FocusSession, Settings, UsageHistory } from "../lib/types";

const REMOTE_USAGE_KEY = "sync.remoteUsageView";

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
        get("usage"),
        get("settings"),
        get("focus"),
        get("focusLog"),
        get("termsAccepted"),
        loadRemoteUsage(),
      ]);
      localUsage = usage;
      remoteUsage = remote;
      if (alive) setState({ usage: mergeUsage(usage, remote), settings, focus, focusLog, termsAccepted, ready: true });
    };
    void load();
    const stop = watch((changed) => {
      if ("usage" in changed) localUsage = changed.usage ?? {};
      if (REMOTE_USAGE_KEY in changed) {
        remoteUsage = (changed as Record<string, UsageHistory>)[REMOTE_USAGE_KEY] ?? {};
      }
      setState((prev) => ({
        usage:
          "usage" in changed || REMOTE_USAGE_KEY in changed ? mergeUsage(localUsage, remoteUsage) : prev.usage,
        settings: changed.settings ?? prev.settings,
        focus: "focus" in changed ? (changed.focus ?? null) : prev.focus,
        focusLog: changed.focusLog ?? prev.focusLog,
        termsAccepted: changed.termsAccepted ?? prev.termsAccepted,
        ready: true,
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
