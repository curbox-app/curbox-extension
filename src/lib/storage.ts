import { browser } from "#imports";
import type { DateKey, DayUsage, FocusLogEntry, FocusSession, ProceedRecord, Settings, SiteOpens, UsageHistory } from "./types";
import { normalizeSettings } from "./types";
import type { StoredList } from "./word-lists";

interface StoreShape {
  settings: Settings;
  focus: FocusSession | null;
  focusLog: FocusLogEntry[];
  grants: Record<string, number>; // groupId -> granted until (ms)
  proceeds: Record<string, ProceedRecord>; // groupId -> proceed tally
  termsAccepted: boolean;
  opens: SiteOpens;
  wordLists: Record<string, StoredList>; // local only, see word-lists.ts
}

export const DEFAULT_SETTINGS: Settings = normalizeSettings({});

const DEFAULTS: { [K in keyof StoreShape]: () => StoreShape[K] } = {
  settings: () => DEFAULT_SETTINGS,
  focus: () => null,
  focusLog: () => [],
  grants: () => ({}),
  proceeds: () => ({}),
  termsAccepted: () => false,
  opens: () => ({ last: "", days: {} }),
  wordLists: () => ({}),
};

// Usage is stored one day per key, so the tracker's tick only rewrites today
// and every listener only receives the day that changed.
const USAGE_PREFIX = "usage:";
const LEGACY_USAGE = "usage";
const USAGE_LOCK = "usage";

export const usageKey = (day: DateKey) => `${USAGE_PREFIX}${day}`;
export const isUsageKey = (key: string) => key.startsWith(USAGE_PREFIX);
export const usageDay = (key: string): DateKey => key.slice(USAGE_PREFIX.length);

// Settings are normalized once per stored object, not once per read.
const normalized = new WeakMap<object, Settings>();

function fromStore(key: string, raw: unknown): unknown {
  if (key === "settings") {
    if (!raw || typeof raw !== "object") return DEFAULT_SETTINGS;
    let settings = normalized.get(raw);
    if (!settings) normalized.set(raw, (settings = normalizeSettings(raw)));
    return settings;
  }
  return raw ?? DEFAULTS[key as keyof StoreShape]?.();
}

// The worker reads the same keys for every tab it evaluates. When caching is
// on, reads come from memory and storage events keep that memory current.
const cache = new Map<string, unknown>();
const versions = new Map<string, number>();
const writing = new Map<string, number>();
const dirty = new Set<string>();
let caching = false;

const bump = (key: string) => versions.set(key, (versions.get(key) ?? 0) + 1);
// Imported lists can be megabytes of text and are compiled once elsewhere.
const cacheable = (key: string) => caching && key !== "wordLists";

function onStorageChanged(changes: Record<string, { newValue?: unknown }>): void {
  for (const key of Object.keys(changes)) {
    bump(key);
    // A change landing during our own write may be newer or older than it,
    // so drop the entry once the write settles and read storage again.
    if (writing.get(key)) dirty.add(key);
    else if (cache.has(key)) cache.set(key, changes[key].newValue);
  }
}

export function enableStorageCache(): void {
  caching = true;
  cache.clear();
  browser.storage.local.onChanged.removeListener(onStorageChanged);
  browser.storage.local.onChanged.addListener(onStorageChanged);
}

async function readRaw(keys: string[]): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  const missing: string[] = [];
  for (const key of keys) {
    if (cache.has(key)) out[key] = cache.get(key);
    else missing.push(key);
  }
  if (missing.length === 0) return out;
  const seen = missing.map((key) => versions.get(key) ?? 0);
  const res = await browser.storage.local.get(missing);
  missing.forEach((key, i) => {
    out[key] = res[key];
    if (cacheable(key) && (versions.get(key) ?? 0) === seen[i] && !writing.get(key)) cache.set(key, res[key]);
  });
  return out;
}

async function writeRaw(items: Record<string, unknown>, removals: string[] = []): Promise<void> {
  const keys = [...Object.keys(items), ...removals];
  for (const key of keys) {
    bump(key);
    writing.set(key, (writing.get(key) ?? 0) + 1);
  }
  let ok = false;
  try {
    if (Object.keys(items).length > 0) await browser.storage.local.set(items);
    if (removals.length > 0) await browser.storage.local.remove(removals);
    ok = true;
  } finally {
    for (const key of keys) {
      const left = (writing.get(key) ?? 1) - 1;
      if (left > 0) writing.set(key, left);
      else writing.delete(key);
      const stale = !ok || dirty.has(key) || left > 0 || !(key in items);
      if (left === 0) dirty.delete(key);
      if (!cacheable(key)) continue;
      if (stale) cache.delete(key);
      else cache.set(key, items[key]);
    }
  }
}

export async function get<K extends keyof StoreShape>(key: K): Promise<StoreShape[K]> {
  const res = await readRaw([key]);
  return fromStore(key, res[key]) as StoreShape[K];
}

export async function set<K extends keyof StoreShape>(key: K, value: StoreShape[K]): Promise<void> {
  if (key !== "settings") return writeRaw({ [key]: value });
  const settings = normalizeSettings(value);
  normalized.set(settings, settings);
  await writeRaw({ settings });
}

// Read, change and write one key at a time, so two updates in this context can
// never both read the old value and drop each other's change.
const locks = new Map<string, Promise<unknown>>();

function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const run = (locks.get(key) ?? Promise.resolve()).then(fn);
  const settled = run.catch(() => undefined);
  locks.set(key, settled);
  void settled.then(() => {
    if (locks.get(key) === settled) locks.delete(key);
  });
  return run;
}

export function update<K extends keyof StoreShape>(
  key: K,
  mutate: (current: StoreShape[K]) => StoreShape[K],
): Promise<StoreShape[K]> {
  return withLock(key, async () => {
    const current = await get(key);
    const next = mutate(current);
    // Returning the same object means nothing changed, so skip the write.
    if (next !== current) await set(key, next);
    return next;
  });
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

// Older releases could store settings that predate the current shape. Write
// the upgraded copy back once, from the worker only, so ids stay stable.
export async function migrateSettings(): Promise<void> {
  const raw = (await readRaw(["settings"])).settings;
  if (!raw) return;
  const settings = fromStore("settings", raw);
  if (JSON.stringify(settings) !== JSON.stringify(raw)) await writeRaw({ settings });
}

export async function getUsage(days: DateKey[]): Promise<UsageHistory> {
  const res = await readRaw([...days.map(usageKey), LEGACY_USAGE]);
  const legacy = res[LEGACY_USAGE] as UsageHistory | undefined;
  const out: UsageHistory = {};
  for (const day of days) {
    const value = (res[usageKey(day)] as DayUsage | undefined) ?? legacy?.[day];
    if (value) out[day] = value;
  }
  return out;
}

// Splits the single usage key older releases wrote into day keys. Only the
// worker writes usage, and every read prefers a day key over the legacy one,
// so a half finished migration never double counts. The check is a cached
// read in the worker, so it runs before every write.
let migration: Promise<void> | null = null;

function migrateUsage(): Promise<void> {
  migration ??= (async () => {
    const legacy = (await readRaw([LEGACY_USAGE]))[LEGACY_USAGE] as UsageHistory | undefined;
    if (!legacy) return;
    const existing = await readRaw(Object.keys(legacy).map(usageKey));
    const items: Record<string, unknown> = {};
    for (const [day, value] of Object.entries(legacy)) {
      if (existing[usageKey(day)] === undefined) items[usageKey(day)] = value;
    }
    await writeRaw(items, [LEGACY_USAGE]);
  })().finally(() => (migration = null));
  return migration;
}

export async function updateUsageDays(
  days: DateKey[],
  mutate: (day: DateKey, current: DayUsage | undefined) => DayUsage | null,
): Promise<void> {
  await migrateUsage();
  await withLock(USAGE_LOCK, async () => {
    const current = await getUsage(days);
    const items: Record<string, unknown> = {};
    for (const day of days) {
      const next = mutate(day, current[day]);
      if (next) items[usageKey(day)] = next;
    }
    await writeRaw(items);
  });
}

async function storedKeys(): Promise<string[]> {
  const local = browser.storage.local as typeof browser.storage.local & { getKeys?: () => Promise<string[]> };
  if (typeof local.getKeys === "function") return local.getKeys();
  return Object.keys(await browser.storage.local.get(null));
}

const PRUNED_KEY = "usagePrunedBefore";

export async function pruneUsage(cutoff: DateKey): Promise<void> {
  await migrateUsage();
  if ((await readRaw([PRUNED_KEY]))[PRUNED_KEY] === cutoff) return;
  const stale = (await storedKeys()).filter((key) => isUsageKey(key) && usageDay(key) < cutoff);
  await writeRaw({ [PRUNED_KEY]: cutoff }, stale);
}

export function watch(listener: (changed: Partial<StoreShape> & Record<string, unknown>) => void): () => void {
  const handler = (changes: Record<string, { newValue?: unknown }>) => {
    const changed: Record<string, unknown> = {};
    for (const k of Object.keys(changes)) changed[k] = fromStore(k, changes[k].newValue);
    listener(changed as Partial<StoreShape> & Record<string, unknown>);
  };
  browser.storage.local.onChanged.addListener(handler);
  return () => browser.storage.local.onChanged.removeListener(handler);
}
