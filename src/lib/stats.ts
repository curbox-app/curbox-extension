import type { DateKey, UsageHistory } from "./types";

export function dayTotal(usage: UsageHistory, key: DateKey): number {
  const day = usage[key];
  if (!day) return 0;
  return Object.values(day).reduce((sum, d) => sum + d.ms, 0);
}

export interface DomainRow {
  domain: string;
  ms: number;
  paths: { path: string; ms: number }[];
}

export function domainsForDay(usage: UsageHistory, key: DateKey): DomainRow[] {
  const day = usage[key] ?? {};
  return Object.entries(day)
    .map(([domain, d]) => ({
      domain,
      ms: d.ms,
      paths: Object.entries(d.paths)
        .map(([path, ms]) => ({ path, ms }))
        .sort((a, b) => b.ms - a.ms),
    }))
    .sort((a, b) => b.ms - a.ms);
}
