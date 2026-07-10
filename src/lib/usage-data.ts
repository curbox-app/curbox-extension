import { dateKey, startOfNextLocalDay } from "./time";
import type { DateKey, DayUsage, DomainUsage, UsageHistory } from "./types";

// Usage older than four weeks is cleared automatically, on every platform.
export const RETENTION_DAYS = 28;

export const MAX_PATHS_PER_DOMAIN = 200;

export function addUsage(day: DayUsage, domain: string, path: string, ms: number): void {
  const entry = (day[domain] ??= { ms: 0, paths: {} });
  entry.ms += ms;
  entry.paths[path] = (entry.paths[path] ?? 0) + ms;
}

export function sliceSpanByDay(from: number, to: number): Array<{ key: DateKey; ms: number }> {
  const slices: Array<{ key: DateKey; ms: number }> = [];
  let start = from;
  while (start < to) {
    const boundary = startOfNextLocalDay(new Date(start));
    // A boundary that fails to advance (broken clock or timezone data) must
    // never hang the worker: credit the rest to the current day and stop.
    const end = boundary > start ? Math.min(to, boundary) : to;
    slices.push({ key: dateKey(new Date(start)), ms: end - start });
    start = end;
  }
  return slices;
}

export function mergeUsage(
  base: UsageHistory,
  deltas: Iterable<[DateKey, DayUsage]>,
  now = Date.now(),
): UsageHistory {
  const cutoff = dateKey(new Date(now - RETENTION_DAYS * 86_400_000));
  const next: UsageHistory = {};
  for (const [key, day] of Object.entries(base)) {
    if (key >= cutoff) next[key] = day;
  }
  for (const [key, day] of deltas) {
    if (key < cutoff) continue;
    const target = { ...(next[key] ?? {}) };
    for (const [domain, buf] of Object.entries(day)) {
      const entry = target[domain];
      const paths = { ...entry?.paths };
      for (const [path, ms] of Object.entries(buf.paths)) {
        paths[path] = (paths[path] ?? 0) + ms;
      }
      const merged = { ms: (entry?.ms ?? 0) + buf.ms, paths };
      capPaths(merged);
      target[domain] = merged;
    }
    next[key] = target;
  }
  return next;
}

function capPaths(entry: DomainUsage): void {
  const keys = Object.keys(entry.paths);
  if (keys.length <= MAX_PATHS_PER_DOMAIN) return;
  keys.sort((a, b) => entry.paths[b] - entry.paths[a]);
  let folded = 0;
  for (const key of keys.slice(MAX_PATHS_PER_DOMAIN - 1)) {
    folded += entry.paths[key];
    delete entry.paths[key];
  }
  entry.paths["/"] = (entry.paths["/"] ?? 0) + folded;
}
