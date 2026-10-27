import { dateKey, startOfNextLocalDay } from "./time";
import type { DateKey, DayUsage, DomainUsage, UsageHistory } from "./types";

// Usage older than four weeks is cleared automatically, on every platform.
export const RETENTION_DAYS = 28;

export const MAX_PATHS_PER_DOMAIN = 200;

export function addUsage(day: DayUsage, domain: string, path: string, ms: number, hour?: number): void {
  const entry = (day[domain] ??= { ms: 0, paths: {} });
  entry.ms += ms;
  entry.paths[path] = (entry.paths[path] ?? 0) + ms;
  if (hour != null && hour >= 0 && hour < 24) {
    const hours = (entry.hours ??= {});
    hours[hour] = (hours[hour] ?? 0) + ms;
    const pathHours = (entry.pathHours ??= {});
    const buckets = (pathHours[path] ??= {});
    buckets[hour] = (buckets[hour] ?? 0) + ms;
  }
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

export function sliceSpanByHour(from: number, to: number): Array<{ key: DateKey; hour: number; ms: number }> {
  const slices: Array<{ key: DateKey; hour: number; ms: number }> = [];
  let start = from;
  while (start < to) {
    const current = new Date(start);
    const boundary = new Date(
      current.getFullYear(),
      current.getMonth(),
      current.getDate(),
      current.getHours() + 1,
      0,
      0,
      0,
    ).getTime();
    const end = boundary > start ? Math.min(to, boundary) : to;
    slices.push({ key: dateKey(current), hour: current.getHours(), ms: end - start });
    start = end;
  }
  return slices;
}

export function retentionCutoff(now = Date.now()): DateKey {
  return dateKey(new Date(now - RETENTION_DAYS * 86_400_000));
}

export function mergeUsage(
  base: UsageHistory,
  deltas: Iterable<[DateKey, DayUsage]>,
  now = Date.now(),
): UsageHistory {
  const cutoff = retentionCutoff(now);
  const next: UsageHistory = {};
  for (const [key, day] of Object.entries(base)) {
    if (key >= cutoff) next[key] = day;
  }
  for (const [key, day] of deltas) {
    if (key >= cutoff) next[key] = mergeDay(next[key], day);
  }
  return next;
}

export function mergeDay(base: DayUsage | undefined, delta: DayUsage): DayUsage {
  const target = { ...base };
  for (const [domain, buf] of Object.entries(delta)) {
    const entry = target[domain];
    const paths = { ...entry?.paths };
    for (const [path, ms] of Object.entries(buf.paths)) {
      paths[path] = (paths[path] ?? 0) + ms;
    }
    const hours = addBuckets(entry?.hours, buf.hours);
    const pathHours = { ...entry?.pathHours };
    for (const [path, buckets] of Object.entries(buf.pathHours ?? {})) {
      pathHours[path] = addBuckets(pathHours[path], buckets) ?? {};
    }
    const merged: DomainUsage = { ms: (entry?.ms ?? 0) + buf.ms, paths };
    if (hours) merged.hours = hours;
    if (Object.keys(pathHours).length > 0) merged.pathHours = pathHours;
    capPaths(merged);
    target[domain] = merged;
  }
  return target;
}

function capPaths(entry: DomainUsage): void {
  const keys = Object.keys(entry.paths);
  if (keys.length <= MAX_PATHS_PER_DOMAIN) return;
  const overflow = keys
    .filter((key) => key !== "/")
    .sort((a, b) => entry.paths[b] - entry.paths[a])
    .slice(MAX_PATHS_PER_DOMAIN - 1);
  let folded = entry.paths["/"] ?? 0;
  let foldedBuckets = entry.pathHours?.["/"];
  for (const key of overflow) {
    folded += entry.paths[key];
    const buckets = entry.pathHours?.[key];
    if (buckets) {
      foldedBuckets = addBuckets(foldedBuckets, buckets);
      delete entry.pathHours![key];
    }
    delete entry.paths[key];
  }
  entry.paths["/"] = folded;
  if (foldedBuckets && entry.pathHours) entry.pathHours["/"] = foldedBuckets;
}

function addBuckets(a?: Record<number, number>, b?: Record<number, number>): Record<number, number> | undefined {
  if (!a && !b) return undefined;
  const result: Record<number, number> = {};
  for (let hour = 0; hour < 24; hour++) {
    const total = (a?.[hour] ?? 0) + (b?.[hour] ?? 0);
    if (total > 0) result[hour] = total;
  }
  return result;
}
