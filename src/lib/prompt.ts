import { groupMatches } from "./match";
import { siteName } from "./site";
import { dayTotal } from "./stats";
import { dateKey } from "./time";
import type { DayUsage, GentlePromptConfig, Settings, SiteOpens, UsageHistory } from "./types";

// Mirrors Android MindfulMessageVariables so one message reads the same on
// both platforms.
export interface PromptValues {
  appName: string;
  appUsageTodayMs: number;
  appUsageYesterdayMs: number;
  appOpensToday: number;
  screenTimeTodayMs: number;
  screenTimeYesterdayMs: number;
  mindfulUsageTodayMs: number;
  reelCount: number;
  /** Keyed by lowercase blocker group name. */
  groupUsageToday: Record<string, number>;
  groupUsageYesterday: Record<string, number>;
}

export const PROMPT_VARIABLES = [
  "{app_name}",
  "{app_usage_today}",
  "{app_usage_yesterday}",
  "{app_opens_today}",
  "{screentime_today}",
  "{screentime_yesterday}",
  "{mindful_apps_usage_today}",
  "{live_session_duration}",
  "{reel_count}",
];

const GROUP_TODAY = /\{group_usage_today:([^{}]+)\}/g;
const GROUP_YESTERDAY = /\{group_usage_yesterday:([^{}]+)\}/g;

// A short video page: YouTube Shorts, Instagram and Facebook Reels, TikTok videos.
const REEL_PATH = /^\/(?:shorts|reels?)\/[^/?#]+|^\/@[^/]+\/video\/\d+/i;

export function formatPrompt(template: string, values: PromptValues, liveSessionMs: number): string {
  const group = (totals: Record<string, number>) => (match: string, name: string) => {
    const ms = totals[name.trim().toLowerCase()];
    return ms === undefined ? match : formatUsage(ms);
  };
  return template
    .replaceAll("{app_name}", values.appName)
    .replaceAll("{app_usage_today}", formatUsage(values.appUsageTodayMs))
    .replaceAll("{app_usage_yesterday}", formatUsage(values.appUsageYesterdayMs))
    .replaceAll("{app_opens_today}", String(values.appOpensToday))
    .replaceAll("{screentime_today}", formatUsage(values.screenTimeTodayMs))
    .replaceAll("{screentime_yesterday}", formatUsage(values.screenTimeYesterdayMs))
    .replaceAll("{mindful_apps_usage_today}", formatUsage(values.mindfulUsageTodayMs))
    .replaceAll("{live_session_duration}", formatSession(liveSessionMs))
    .replaceAll("{reel_count}", String(values.reelCount))
    .replace(GROUP_TODAY, group(values.groupUsageToday))
    .replace(GROUP_YESTERDAY, group(values.groupUsageYesterday));
}

export function promptValues(
  domain: string,
  usage: UsageHistory,
  opens: SiteOpens,
  settings: Settings,
  now = Date.now(),
): PromptValues {
  const todayKey = dateKey(new Date(now));
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = dateKey(yesterday);
  const today = usage[todayKey] ?? {};
  const prior = usage[yesterdayKey] ?? {};
  return {
    appName: siteName(domain),
    appUsageTodayMs: today[domain]?.ms ?? 0,
    appUsageYesterdayMs: prior[domain]?.ms ?? 0,
    appOpensToday: opens.days[todayKey]?.[domain] ?? 0,
    screenTimeTodayMs: dayTotal(usage, todayKey),
    screenTimeYesterdayMs: dayTotal(usage, yesterdayKey),
    mindfulUsageTodayMs: matchedUsage(today, settings.gentlePrompt.sites),
    reelCount: reelCount(today),
    groupUsageToday: groupTotals(today, settings),
    groupUsageYesterday: groupTotals(prior, settings),
  };
}

function matchedUsage(day: DayUsage, matchers: string[]): number {
  let total = 0;
  for (const [domain, entry] of Object.entries(day)) {
    for (const [path, ms] of Object.entries(entry.paths)) {
      if (groupMatches({ domain, path }, matchers)) total += ms;
    }
  }
  return total;
}

// Groups that share a name count as one, like Android.
function groupTotals(day: DayUsage, settings: Settings): Record<string, number> {
  const matchersByName = new Map<string, string[]>();
  for (const group of settings.groups) {
    const name = group.name.trim().toLowerCase();
    matchersByName.set(name, [...(matchersByName.get(name) ?? []), ...group.matchers]);
  }
  return Object.fromEntries([...matchersByName].map(([name, matchers]) => [name, matchedUsage(day, matchers)]));
}

function reelCount(day: DayUsage): number {
  return Object.values(day).reduce(
    (count, entry) => count + Object.keys(entry.paths).filter((path) => REEL_PATH.test(path)).length,
    0,
  );
}

function formatUsage(ms: number): string {
  const totalMin = Math.floor(Math.max(0, ms) / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return [h > 0 ? `${h} hr` : "", m > 0 ? `${m} mins` : ""].filter(Boolean).join(" ") || "0 mins";
}

function formatSession(ms: number): string {
  const totalSec = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function promptLook(config: GentlePromptConfig, scale = 1): { fontSize: string; color: string; background: string } {
  return {
    fontSize: `${config.textSize * scale}px`,
    color: hexToRgba(config.textColor, config.textOpacity),
    background: hexToRgba(config.bgColor, config.bgOpacity),
  };
}

function hexToRgba(hex: string, opacity: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${opacity / 100})`;
}
