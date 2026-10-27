import { get } from "../lib/storage";
import type { Settings } from "../lib/types";

export interface SettingsFeed {
  current: () => Promise<Settings>;
  subscribe: (listener: () => void) => void;
  push: (settings: Settings) => void;
}

// One storage read per page. After that the worker pushes changes, so pages
// never listen to storage and never receive the usage it writes every tick.
export function createSettingsFeed(): SettingsFeed {
  let current = get("settings");
  const listeners: Array<() => void> = [];
  return {
    current: () => current,
    subscribe: (listener) => void listeners.push(listener),
    push: (settings) => {
      current = Promise.resolve(settings);
      for (const listener of listeners) listener();
    },
  };
}
