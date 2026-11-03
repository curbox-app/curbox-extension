import type { DateKey, UsageHistory } from "../types";

// Daily site totals sent to Curbox Sync, so the phone can show both devices together.
export const USAGE_DAYS = 28;
export const MAX_SITES = 40;
export const DAYS_PER_REQUEST = 7;
// Today grows every second; resend it once it moved by a minute.
const RESEND_MS = 60_000;

export interface UsageDay {
  date: DateKey;
  totalMs: number;
  sites: { domain: string; ms: number }[];
}

export function usageDays(history: UsageHistory, days: DateKey[], ignored: string[]): UsageDay[] {
  const skip = new Set(ignored);
  const out: UsageDay[] = [];
  for (const date of days) {
    const sites = Object.entries(history[date] ?? {})
      .filter(([domain, u]) => !skip.has(domain) && u.ms > 0)
      .map(([domain, u]) => ({ domain, ms: Math.round(u.ms) }))
      .sort((a, b) => b.ms - a.ms);
    const totalMs = sites.reduce((n, s) => n + s.ms, 0);
    if (totalMs > 0) out.push({ date, totalMs, sites: sites.slice(0, MAX_SITES) });
  }
  return out;
}

/** Days the phone lacks or holds an older total for. */
export function changedDays(local: UsageDay[], known: Record<DateKey, number> | null): UsageDay[] {
  return local.filter((d) => {
    const have = known?.[d.date];
    return have === undefined || Math.abs(have - d.totalMs) >= RESEND_MS;
  });
}

/** A short name the phone shows for this browser, like "Firefox on Mac". */
export function clientName(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): string {
  const browser = /Firefox\//.test(ua)
    ? "Firefox"
    : /Edg\//.test(ua)
      ? "Edge"
      : /OPR\//.test(ua)
        ? "Opera"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : "Browser";
  const os = /Android/.test(ua)
    ? "Android"
    : /Mac OS X|Macintosh/.test(ua)
      ? "Mac"
      : /Windows/.test(ua)
        ? "Windows"
        : /CrOS/.test(ua)
          ? "ChromeOS"
          : /Linux/.test(ua)
            ? "Linux"
            : "";
  return os ? `${browser} on ${os}` : browser;
}
