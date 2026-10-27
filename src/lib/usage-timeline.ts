import { MONTHS, dateKey } from "./time";
import type { DateKey } from "./types";

// Port of Android AppUsageChartTimeline and the period rules in
// AllAppsUsageViewModel: weeks start on Monday, the daily chart shows one
// calendar week, the weekly chart shows four weeks per page.

export type ChartScale = "days" | "weeks";

export interface UsagePeriod {
  start: DateKey;
  end: DateKey; // inclusive
  label: string;
}

export const WEEKS_PER_PAGE = 4;

const DAY_LABELS = ["M", "T", "W", "T", "F", "S", "S"];

function parse(key: DateKey): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12);
}

export function addDays(key: DateKey, days: number): DateKey {
  const date = parse(key);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function shortDate(key: DateKey): string {
  const date = parse(key);
  return `${MONTHS[date.getMonth()]} ${date.getDate()}`;
}

export function weekStart(today: DateKey, offset: number): DateKey {
  const sinceMonday = (parse(today).getDay() + 6) % 7;
  return addDays(today, offset * 7 - sinceMonday);
}

export function periods(scale: ChartScale, anchorWeekStart: DateKey): UsagePeriod[] {
  if (scale === "days") {
    return DAY_LABELS.map((label, i) => {
      const day = addDays(anchorWeekStart, i);
      return { start: day, end: day, label };
    });
  }
  return Array.from({ length: WEEKS_PER_PAGE }, (_, i) => {
    const start = addDays(anchorWeekStart, -(WEEKS_PER_PAGE - 1 - i) * 7);
    return { start, end: addDays(start, 6), label: shortDate(start) };
  });
}

export function defaultSelectedIndex(list: UsagePeriod[], today: DateKey): number {
  const index = list.findIndex((p) => p.start <= today && today <= p.end);
  return index >= 0 ? index : list.length - 1;
}

export function weekOffsetFor(period: UsagePeriod, today: DateKey): number {
  const diff = parse(period.start).getTime() - parse(weekStart(today, 0)).getTime();
  return Math.round(diff / (7 * 86_400_000));
}

export function navigationStep(scale: ChartScale): number {
  return scale === "days" ? 1 : WEEKS_PER_PAGE;
}

/** Days in the period up to and including today. */
export function datesIn(period: UsagePeriod, today: DateKey): DateKey[] {
  const out: DateKey[] = [];
  const end = period.end < today ? period.end : today;
  for (let day = period.start; day <= end; day = addDays(day, 1)) out.push(day);
  return out;
}

export function formatRange(start: DateKey, end: DateKey): string {
  return start === end ? shortDate(start) : `${shortDate(start)} to ${shortDate(end)}`;
}

export function totalLabel(period: UsagePeriod, scale: ChartScale, today: DateKey): string {
  if (period.start === today && period.end === today) return "TOTAL TODAY";
  if (scale === "weeks" && period.start <= today && today <= period.end) return "TOTAL THIS WEEK";
  return `TOTAL · ${formatRange(period.start, period.end)}`;
}
