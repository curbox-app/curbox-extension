import { useEffect, useState } from "react";
import { get, set, watch, DEFAULT_SETTINGS } from "../lib/storage";
import type { FocusLogEntry, FocusSession, Settings, UsageHistory } from "../lib/types";

export interface CurboxState {
  usage: UsageHistory;
  settings: Settings;
  focus: FocusSession | null;
  focusLog: FocusLogEntry[];
  ready: boolean;
}

export function useCurbox() {
  const [state, setState] = useState<CurboxState>({
    usage: {},
    settings: DEFAULT_SETTINGS,
    focus: null,
    focusLog: [],
    ready: false,
  });

  useEffect(() => {
    let alive = true;
    const load = async () => {
      const [usage, settings, focus, focusLog] = await Promise.all([
        get("usage"),
        get("settings"),
        get("focus"),
        get("focusLog"),
      ]);
      if (alive) setState({ usage, settings, focus, focusLog, ready: true });
    };
    void load();
    const stop = watch((changed) => {
      setState((prev) => ({
        usage: changed.usage ?? prev.usage,
        settings: changed.settings ?? prev.settings,
        focus: "focus" in changed ? (changed.focus ?? null) : prev.focus,
        focusLog: changed.focusLog ?? prev.focusLog,
        ready: true,
      }));
    });
    return () => {
      alive = false;
      stop();
    };
  }, []);

  const saveSettings = (settings: Settings) => set("settings", settings);

  return { ...state, saveSettings };
}
