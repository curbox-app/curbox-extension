import type { DateKey, UsageHistory } from "./types";

export function dayTotal(usage: UsageHistory, key: DateKey, ignored: string[] = []): number {
  return Object.entries(usage[key] ?? {}).reduce((sum, [domain, d]) => (ignored.includes(domain) ? sum : sum + d.ms), 0);
}

export interface DomainRow {
  domain: string;
  ms: number;
  paths: { path: string; ms: number }[];
}

/** Sites across the given days, busiest first. Ignored sites are left out, like Android. */
export function domainsForDays(usage: UsageHistory, keys: DateKey[], ignored: string[] = []): DomainRow[] {
  const merged = new Map<string, { ms: number; paths: Map<string, number> }>();
  for (const key of keys) {
    for (const [domain, d] of Object.entries(usage[key] ?? {})) {
      if (ignored.includes(domain)) continue;
      const row = merged.get(domain) ?? { ms: 0, paths: new Map<string, number>() };
      row.ms += d.ms;
      for (const [path, ms] of Object.entries(d.paths)) row.paths.set(path, (row.paths.get(path) ?? 0) + ms);
      merged.set(domain, row);
    }
  }
  return [...merged]
    .map(([domain, row]) => ({
      domain,
      ms: row.ms,
      paths: [...row.paths].map(([path, ms]) => ({ path, ms })).sort((a, b) => b.ms - a.ms),
    }))
    .sort((a, b) => b.ms - a.ms);
}

/** Every site in the history, busiest first, for the ignored site picker. */
export function allDomains(usage: UsageHistory): string[] {
  return domainsForDays(usage, Object.keys(usage)).map((row) => row.domain);
}
