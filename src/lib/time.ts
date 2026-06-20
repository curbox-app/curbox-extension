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

export function lastNDays(n: number, end = new Date()): DateKey[] {
  const keys: DateKey[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
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

export function msToClock(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const mm = `${m}`.padStart(2, "0");
  const ss = `${s}`.padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
