import type { SiteLocation } from "../lib/url";
import { groupMatches } from "../lib/match";
import { dateKey } from "../lib/time";
import type {
  BlockDecision,
  BlockGroup,
  BlockReason,
  DaySchedule,
  FocusLogEntry,
  FocusSession,
  ProceedRecord,
  Settings,
  TimeRange,
  UsageHistory,
  WarningScreen,
} from "../lib/types";

interface EvalInput {
  location: SiteLocation;
  settings: Settings;
  focus: FocusSession | null;
  usage: UsageHistory;
  focusLog: FocusLogEntry[];
  now: number;
  grants: Record<string, number>;
  proceeds: Record<string, ProceedRecord>;
}

interface ActiveWindow {
  start: number;
  end: number;
}

export const PASS: BlockDecision = {
  blocked: false,
  source: "group",
  groupId: "",
  groupName: "",
  reason: "",
  message: "",
  warning: null,
  canProceed: false,
  focusExitable: false,
  focusGoalRemainingMs: 0,
};

function focusBlocks(location: SiteLocation, focus: FocusSession): boolean {
  const listed = groupMatches(location, focus.domains);
  return focus.mode === "only-these" ? listed : !listed;
}

export function activeWindow(schedule: DaySchedule, now: number): ActiveWindow | null {
  const current = new Date(now);
  const today = current.getDay();
  const minute = current.getHours() * 60 + current.getMinutes();
  const startOfToday = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();

  const find = (day: number, previousDay: boolean): ActiveWindow | null => {
    const config = schedule.days[day];
    if (!config?.active) return null;
    for (const range of config.ranges) {
      if (!rangeIsActive(minute, range, previousDay)) continue;
      const dayOffset = previousDay ? -1 : 0;
      const start = localMinute(startOfToday, dayOffset, range.start);
      const endsNextDay = range.start > range.end || range.end === 1440;
      const end = localMinute(startOfToday, dayOffset + (endsNextDay ? 1 : 0), range.end === 1440 ? 0 : range.end);
      return { start, end };
    }
    return null;
  };

  return find(today, false) ?? find((today + 6) % 7, true);
}

function rangeIsActive(minute: number, range: TimeRange, previousDay: boolean): boolean {
  if (previousDay) return range.start > range.end && minute < range.end;
  if (range.start < range.end) return minute >= range.start && minute < range.end;
  if (range.start > range.end) return minute >= range.start;
  return false;
}

function localMinute(startOfToday: number, dayOffset: number, minute: number): number {
  const day = new Date(startOfToday);
  day.setDate(day.getDate() + dayOffset);
  day.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
  return day.getTime();
}

function blockReason(group: BlockGroup, usage: UsageHistory, window: ActiveWindow, now: number): BlockReason {
  if (group.onEachOpen) return "on-open";
  // Android applies the current calendar day's limit even when the active
  // interval began before midnight.
  const day = new Date(now).getDay();
  const limitMinutes = group.schedule.days[day]?.limitMinutes ?? 0;
  if (limitMinutes <= 0) return "time";
  return sumGroupUsage(group.matchers, usage, window) >= limitMinutes * 60_000 ? "usage" : "";
}

function sumGroupUsage(matchers: string[], usage: UsageHistory, window: ActiveWindow): number {
  let total = 0;
  const startDay = new Date(window.start);
  const endDay = new Date(Math.max(window.start, window.end - 1));
  const keys = dateKey(startDay) === dateKey(endDay) ? [dateKey(startDay)] : [dateKey(startDay), dateKey(endDay)];
  for (const key of keys) {
    for (const [domain, domainUsage] of Object.entries(usage[key] ?? {})) {
      for (const [path, ms] of Object.entries(domainUsage.paths)) {
        if (!groupMatches({ domain, path }, matchers)) continue;
        const buckets = domainUsage.pathHours?.[path];
        if (!buckets) {
          if (isWholeLocalDay(window, key)) total += ms;
          continue;
        }
        for (let hour = 0; hour < 24; hour++) {
          const bucketMs = buckets[hour] ?? 0;
          if (bucketMs <= 0) continue;
          const [year, month, day] = key.split("-").map(Number);
          const bucketStart = new Date(year, month - 1, day, hour).getTime();
          const bucketEnd = new Date(year, month - 1, day, hour + 1).getTime();
          const overlap = Math.max(0, Math.min(window.end, bucketEnd) - Math.max(window.start, bucketStart));
          if (overlap > 0) total += bucketMs * (overlap / Math.max(1, bucketEnd - bucketStart));
        }
      }
    }
  }
  return Math.round(total);
}

function isWholeLocalDay(window: ActiveWindow, key: string): boolean {
  const [year, month, day] = key.split("-").map(Number);
  const start = new Date(year, month - 1, day).getTime();
  const end = new Date(year, month - 1, day + 1).getTime();
  return window.start <= start && window.end >= end;
}

function canProceed(warning: WarningScreen, record: ProceedRecord | undefined, now: number): boolean {
  if (warning.challenge === "never") return false;
  if (warning.proceedLimit <= 0) return true;
  if (!record) return true;
  if (record.timestamps) {
    const windowMs = warning.proceedWindowMinutes * 60_000;
    return record.timestamps.filter((timestamp) => now - timestamp < windowMs).length < warning.proceedLimit;
  }
  const fresh = now - record.windowStart < warning.proceedWindowMinutes * 60_000;
  return !fresh || record.count < warning.proceedLimit;
}

function focusGoalRemaining(warning: WarningScreen, log: FocusLogEntry[], focus: FocusSession | null, now: number): number {
  if (!warning.focusGoalEnabled) return 0;
  const current = new Date(now);
  const dayStart = new Date(current.getFullYear(), current.getMonth(), current.getDate()).getTime();
  const dayEnd = new Date(current.getFullYear(), current.getMonth(), current.getDate() + 1).getTime();
  const ranges: Array<[number, number]> = log
    .filter((entry) => entry.groupId === warning.focusGoalGroupId)
    .map((entry) => {
      const end = entry.endedAt ?? entry.at;
      const start = entry.startedAt ?? end - Math.max(0, entry.actualMs);
      return [Math.max(dayStart, start), Math.min(dayEnd, end)] as [number, number];
    })
    .filter(([start, end]) => end > start);
  if (focus?.groupId === warning.focusGoalGroupId) {
    ranges.push([Math.max(dayStart, focus.startedAt), Math.min(dayEnd, now, focus.endsAt)]);
  }
  ranges.sort((a, b) => a[0] - b[0]);
  let completed = 0;
  let currentRange: [number, number] | null = null;
  for (const range of ranges) {
    if (!currentRange) currentRange = [...range];
    else if (range[0] <= currentRange[1]) currentRange[1] = Math.max(currentRange[1], range[1]);
    else {
      completed += currentRange[1] - currentRange[0];
      currentRange = [...range];
    }
  }
  if (currentRange) completed += currentRange[1] - currentRange[0];
  return Math.max(0, warning.focusGoalRequiredMinutes * 60_000 - completed);
}

function defaultMessage(group: BlockGroup, reason: BlockReason): string {
  if (group.warning.customMessage.trim()) return group.warning.customMessage.trim();
  if (reason === "usage") return `You've used your time on ${group.name} today. Let's come back to it tomorrow.`;
  if (reason === "time") return `These are your active hours away from ${group.name}. I'll keep it closed for now.`;
  return `Take a breath before you open ${group.name}.`;
}

export function evaluate(input: EvalInput): BlockDecision {
  const { location, settings, focus, usage, focusLog, now, grants, proceeds } = input;

  if (focus && focusBlocks(location, focus)) {
    return {
      blocked: true,
      source: "focus",
      groupId: focus.groupId,
      groupName: focus.name,
      reason: "focus",
      message: `I'm holding your focus right now. ${focus.name} stays paused until you're done.`,
      warning: null,
      canProceed: false,
      focusExitable: focus.exitable,
      focusGoalRemainingMs: 0,
    };
  }

  for (const group of settings.groups) {
    if (!group.enabled || !groupMatches(location, group.matchers)) continue;
    const window = activeWindow(group.schedule, now);
    if (!window) continue;
    const reason = blockReason(group, usage, window, now);
    if (!reason || (grants[group.id] ?? 0) > now) continue;
    const goalRemaining = focusGoalRemaining(group.warning, focusLog, focus, now);
    return {
      blocked: true,
      source: "group",
      groupId: group.id,
      groupName: group.name,
      reason,
      message: defaultMessage(group, reason),
      warning: group.warning,
      canProceed: goalRemaining === 0 && canProceed(group.warning, proceeds[group.id], now),
      focusExitable: false,
      focusGoalRemainingMs: goalRemaining,
    };
  }

  return PASS;
}

export function matchingOnOpenGroups(location: SiteLocation, settings: Settings): string[] {
  return settings.groups
    .filter((group) => group.enabled && group.onEachOpen && groupMatches(location, group.matchers))
    .map((group) => group.id);
}
