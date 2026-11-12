import { useEffect, useState } from "react";
import { browser } from "#imports";
import { get, getUsage, isUsageKey, set, usageDay, watch, DEFAULT_SETTINGS } from "../lib/storage";
import { lastNDays } from "../lib/time";
import { RETENTION_DAYS } from "../lib/usage-data";
import type { DayUsage, FocusLogEntry, FocusSession, Settings, UsageHistory } from "../lib/types";

// Set when the terms are accepted and cleared when onboarding ends, so closing
// the window midway brings the remaining steps back. Older installs never set
// it, so people who already agreed are not walked through it again.
const ONBOARDING_KEY = "ui.onboardingPending";
const WATCHED = new Set(["settings", "focus", "focusLog", "termsAccepted", ONBOARDING_KEY]);

export interface CurboxState {
  usage: UsageHistory;
  settings: Settings;
  focus: FocusSession | null;
  focusLog: FocusLogEntry[];
  termsAccepted: boolean;
  onboardingPending: boolean;
  ready: boolean;
}

export function useCurbox() {
  const [state, setState] = useState<CurboxState>({
    usage: {},
    settings: DEFAULT_SETTINGS,
    focus: null,
    focusLog: [],
    termsAccepted: false,
    onboardingPending: false,
    ready: false,
  });

  useEffect(() => {
    let alive = true;
    let localUsage: UsageHistory = {};

    const load = async () => {
      const [usage, settings, focus, focusLog, termsAccepted, onboarding] = await Promise.all([
        getUsage(lastNDays(RETENTION_DAYS + 1)),
        get("settings"),
        get("focus"),
        get("focusLog"),
        get("termsAccepted"),
        browser.storage.local.get(ONBOARDING_KEY),
      ]);
      // Days written while loading arrive through the watcher; keep the newer copy.
      localUsage = { ...usage, ...localUsage };
      const onboardingPending = onboarding[ONBOARDING_KEY] === true;
      if (alive) setState({ usage: localUsage, settings, focus, focusLog, termsAccepted, onboardingPending, ready: true });
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
      setState((prev) => ({
        usage: usageKeys.length > 0 ? localUsage : prev.usage,
        settings: changed.settings ?? prev.settings,
        focus: "focus" in changed ? (changed.focus ?? null) : prev.focus,
        focusLog: changed.focusLog ?? prev.focusLog,
        termsAccepted: changed.termsAccepted ?? prev.termsAccepted,
        onboardingPending: ONBOARDING_KEY in changed ? changed[ONBOARDING_KEY] === true : prev.onboardingPending,
        ready: prev.ready,
      }));
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const saveSettings = (settings: Settings) => set("settings", settings);
  const acceptTerms = () => browser.storage.local.set({ termsAccepted: true, [ONBOARDING_KEY]: true });
  const finishOnboarding = () => browser.storage.local.remove(ONBOARDING_KEY);

  return { ...state, saveSettings, acceptTerms, finishOnboarding };
}
