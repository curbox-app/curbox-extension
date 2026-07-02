import type { DateKey } from "./types";

export function dateKey(d = new Date()): DateKey {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function todayKey(): DateKey {
  return dateKey();
}

// Epoch ms of the next local midnight after `d`. Used to split a usage span at
// the day boundary so time lands on the day it actually happened on. Going
// through the Date constructor keeps it correct across DST shifts.
export function startOfNextLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 0, 0, 0, 0).getTime();
}

export function lastNDays(n: number, end = new Date()): DateKey[] {
  const keys: DateKey[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    // Anchor at noon so a DST shift can never move a step across midnight and
    // duplicate or skip a day in the graph.
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - i);
    keys.push(dateKey(d));
  }
  return keys;
}

export function weekOf(end: Date): DateKey[] {
  return lastNDays(7, end);
}

// Seven day keys for a week ending `offset` weeks before today (0 = this week).
export function weekKeys(offset: number): DateKey[] {
  const end = new Date();
  end.setDate(end.getDate() - offset * 7);
  return lastNDays(7, end);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function weekRangeLabel(keys: DateKey[]): string {
  const fmt = (key: DateKey) => {
    const [, m, d] = key.split("-").map(Number);
    return `${MONTHS[m - 1]} ${d}`;
  };
  return `${fmt(keys[0])} to ${fmt(keys[keys.length - 1])}`;
}

// Header eyebrow above the big total, mirroring Android's date_sublabel:
// "Total today" for today, otherwise "Total · Mar 15". Uppercased by the
// `.label` utility at the render site.
export function totalSublabel(key: DateKey): string {
  if (key === todayKey()) return "Total today";
  const [, m, d] = key.split("-").map(Number);
  return `Total · ${MONTHS[m - 1]} ${d}`;
}

export const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function dayLabel(key: DateKey): string {
  const [y, m, d] = key.split("-").map(Number);
  return DAY_LABELS[new Date(y, m - 1, d).getDay()];
}

// A readable single date, e.g. "Mon, Jun 15", for past days shown to the user.
export function friendlyDate(key: DateKey): string {
  const [y, m, d] = key.split("-").map(Number);
  return `${WEEKDAYS[new Date(y, m - 1, d).getDay()]}, ${MONTHS[m - 1]} ${d}`;
}

export function nowMinutes(d = new Date()): number {
  return d.getHours() * 60 + d.getMinutes();
}

export function minutesToClock(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return `${`${h}`.padStart(2, "0")}:${`${m}`.padStart(2, "0")}`;
}

export function clockToMinutes(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return h * 60 + m;
}

export function msToHuman(ms: number): string {
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${s}s`;
}

// Compact duration for the big total and list rows, mirroring Android's
// formatTimeForWidget: "2h 30m" / "45m" / "<1m" for anything under a minute.
export function msToWidget(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  if (m > 0) return `${m}m`;
  return "<1m";
}

export function msToClock(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = `${m}`.padStart(2, "0");
  const ss = `${s}`.padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
