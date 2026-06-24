import type { DomainUsage, UsageHistory } from "../types";

// Adds two usage histories together. Used to fold other devices' synced usage
// into this device's own for a unified view. Each device owns its records so
// there is never double counting.
export function mergeUsage(a: UsageHistory, b: UsageHistory): UsageHistory {
  const out: UsageHistory = structuredClone(a);
  for (const [date, day] of Object.entries(b)) {
    const target = (out[date] ??= {});
    for (const [domain, usage] of Object.entries(day)) {
      target[domain] = addDomain(target[domain], usage);
    }
  }
  return out;
}

function addDomain(a: DomainUsage | undefined, b: DomainUsage): DomainUsage {
  if (!a) return structuredClone(b);
  const paths: Record<string, number> = { ...a.paths };
  for (const [path, ms] of Object.entries(b.paths)) paths[path] = (paths[path] ?? 0) + ms;
  return { ms: a.ms + b.ms, paths };
}
