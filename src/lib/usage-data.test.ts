import { describe, expect, it } from "vitest";
import { MAX_PATHS_PER_DOMAIN, RETENTION_DAYS, mergeUsage, sliceSpanByDay } from "./usage-data";
import { dateKey } from "./time";
import type { DayUsage, UsageHistory } from "./types";

const DAY_MS = 86_400_000;

function delta(key: string, day: DayUsage): Array<[string, DayUsage]> {
  return [[key, day]];
}

describe("sliceSpanByDay", () => {
  it("keeps a same day span whole", () => {
    const from = new Date(2026, 5, 15, 10, 0, 0).getTime();
    const slices = sliceSpanByDay(from, from + 5000);
    expect(slices).toEqual([{ key: "2026-06-15", ms: 5000 }]);
  });

  it("splits a span at local midnight", () => {
    const from = new Date(2026, 5, 15, 23, 59, 30).getTime();
    const slices = sliceSpanByDay(from, from + 60_000);
    expect(slices).toEqual([
      { key: "2026-06-15", ms: 30_000 },
      { key: "2026-06-16", ms: 30_000 },
    ]);
  });

  it("returns nothing for an empty span", () => {
    const at = Date.now();
    expect(sliceSpanByDay(at, at)).toEqual([]);
  });
});

describe("mergeUsage", () => {
  it("adds deltas onto existing history without mutating it", () => {
    const now = Date.now();
    const today = dateKey(new Date(now));
    const base: UsageHistory = {
      [today]: { "youtube.com": { ms: 1000, paths: { "/watch": 1000 } } },
    };
    const next = mergeUsage(
      base,
      delta(today, { "youtube.com": { ms: 500, paths: { "/watch": 200, "/shorts": 300 } } }),
      now,
    );
    expect(next[today]["youtube.com"]).toEqual({ ms: 1500, paths: { "/watch": 1200, "/shorts": 300 } });
    expect(base[today]["youtube.com"].ms).toBe(1000);
  });

  it("drops days past retention from base and deltas", () => {
    const now = Date.now();
    const today = dateKey(new Date(now));
    const ancient = dateKey(new Date(now - (RETENTION_DAYS + 5) * DAY_MS));
    const base: UsageHistory = {
      [ancient]: { "old.com": { ms: 1, paths: { "/": 1 } } },
    };
    const next = mergeUsage(base, delta(today, { "new.com": { ms: 2, paths: { "/": 2 } } }), now);
    expect(next[ancient]).toBeUndefined();
    expect(next[today]["new.com"].ms).toBe(2);
    const stale = mergeUsage({}, delta(ancient, { "old.com": { ms: 1, paths: { "/": 1 } } }), now);
    expect(stale[ancient]).toBeUndefined();
  });

  it("folds overflow paths into '/' while keeping the domain total exact", () => {
    const now = Date.now();
    const today = dateKey(new Date(now));
    const paths: Record<string, number> = {};
    for (let i = 0; i < MAX_PATHS_PER_DOMAIN + 50; i++) paths[`/p${i}`] = i + 1;
    const total = Object.values(paths).reduce((a, b) => a + b, 0);
    const next = mergeUsage({}, delta(today, { "reddit.com": { ms: total, paths } }), now);
    const entry = next[today]["reddit.com"];
    expect(entry.ms).toBe(total);
    expect(Object.keys(entry.paths).length).toBeLessThanOrEqual(MAX_PATHS_PER_DOMAIN);
    expect(Object.values(entry.paths).reduce((a, b) => a + b, 0)).toBe(total);
    // The biggest slices survive as-is; the smallest fold into "/".
    expect(entry.paths[`/p${MAX_PATHS_PER_DOMAIN + 49}`]).toBe(MAX_PATHS_PER_DOMAIN + 50);
    expect(entry.paths["/"]).toBeGreaterThan(0);
  });
});
