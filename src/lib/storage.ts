import { browser } from "#imports";
import type { FocusLogEntry, FocusSession, ProceedRecord, Settings, UsageHistory } from "./types";

interface StoreShape {
  usage: UsageHistory;
  settings: Settings;
  focus: FocusSession | null;
  focusLog: FocusLogEntry[];
  grants: Record<string, number>; // groupId -> granted until (ms)
  proceeds: Record<string, ProceedRecord>; // groupId -> proceed tally
  termsAccepted: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  groups: [],
  focusGroups: [],
};

const DEFAULTS: StoreShape = {
  usage: {},
  settings: DEFAULT_SETTINGS,
  focus: null,
  focusLog: [],
  grants: {},
  proceeds: {},
  termsAccepted: false,
};

export async function get<K extends keyof StoreShape>(key: K): Promise<StoreShape[K]> {
  const res = await browser.storage.local.get(key);
  return (res[key] ?? DEFAULTS[key]) as StoreShape[K];
}

export async function set<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

// The sync engine applies remote changes through this so it can recognise its
// own writes and avoid pushing them straight back up (echo suppression).
let applyingRemote = 0;

export async function setFromRemote<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void> {
  applyingRemote++;
  try {
    await set(key, value);
  } finally {
    queueMicrotask(() => {
      applyingRemote = Math.max(0, applyingRemote - 1);
    });
  }
}

export function isApplyingRemote(): boolean {
  return applyingRemote > 0;
}

export async function update<K extends keyof StoreShape>(
  key: K,
  mutate: (current: StoreShape[K]) => StoreShape[K],
): Promise<StoreShape[K]> {
  const next = mutate(await get(key));
  await set(key, next);
  return next;
}

export function watch(listener: (changed: Partial<StoreShape>) => void): () => void {
  const handler = (changes: Record<string, { newValue?: unknown }>) => {
    const changed: Partial<StoreShape> = {};
    for (const k of Object.keys(changes)) {
      (changed as Record<string, unknown>)[k] = changes[k].newValue;
    }
    listener(changed);
  };
  browser.storage.local.onChanged.addListener(handler);
  return () => browser.storage.local.onChanged.removeListener(handler);
}
