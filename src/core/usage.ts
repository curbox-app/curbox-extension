import { update } from "../lib/storage";
import { todayKey } from "../lib/time";
import type { DateKey, DayUsage } from "../lib/types";
import type { SiteLocation } from "../lib/url";

interface ActiveState {
  tabId: number;
  domain: string;
  path: string;
  since: number;
}

const MIN_RECORD_MS = 1000;

// Fallback only. The OS idle gate below is the real defence against banking time
// while the user is away; this catches the one case it cannot: the worker being
// frozen mid-life (system sleep, lid close, hibernation) so no idle event ever
// fires. On resume the next accumulate sees a gap far larger than any real tick
// (~30-60s, browsers clamp the alarm), proving the process was suspended, so that
// span is discarded rather than banked. (A normal worker shutdown resets `active`
// to null and re-baselines on wake, so it never produces such a gap.)
const SUSPEND_GAP_MS = 3 * 60_000;

let active: ActiveState | null = null;
let counting = false;
let windowFocused = true;
let pageVisible = true;
// Mirrors chrome.idle: false the moment the OS reports the machine idle or
// locked (screen off, lid closed, user walked away). This is ground truth from
// the operating system, not a guess, so a closed lid stops counting at once.
let machineActive = true;

// Unpersisted deltas, grouped day -> domain -> usage. Drained on each tick so
// frequent tab/visibility changes only touch memory, never storage.
let pending = new Map<DateKey, DayUsage>();

// We only count time while the active tab is the focused window, the page is
// reporting itself visible, AND the OS says the machine is in active use.
function shouldCount(): boolean {
  return active !== null && windowFocused && pageVisible && machineActive;
}

// Fold the time elapsed since the current window started into the buffer.
function accumulate(): void {
  if (!active) return;
  const now = Date.now();
  const ms = now - active.since;
  active.since = now;
  if (ms < MIN_RECORD_MS || ms > SUSPEND_GAP_MS) return;

  const key = todayKey();
  let day = pending.get(key);
  if (!day) pending.set(key, (day = {}));
  const entry = (day[active.domain] ??= { ms: 0, paths: {} });
  entry.ms += ms;
  entry.paths[active.path] = (entry.paths[active.path] ?? 0) + ms;
}

// Open or close the counting window so time only accrues while visible.
function sync(): void {
  const should = shouldCount();
  if (should === counting) return;
  if (should) {
    if (active) active.since = Date.now();
  } else {
    accumulate();
  }
  counting = should;
}

export function startTracking(tabId: number, location: SiteLocation): void {
  accumulate();
  active = { tabId, domain: location.domain, path: location.path, since: Date.now() };
  counting = false;
  // A freshly focused tab is, by definition, the one the user is looking at.
  pageVisible = true;
  sync();
}

export function stopTracking(): void {
  accumulate();
  active = null;
  counting = false;
}

export function setWindowFocused(value: boolean): void {
  if (value === windowFocused) return;
  windowFocused = value;
  sync();
}

export function setPageVisible(value: boolean): void {
  if (value === pageVisible) return;
  pageVisible = value;
  sync();
}

export function setMachineActive(value: boolean): void {
  if (value === machineActive) return;
  machineActive = value;
  sync();
}

// Write the buffered deltas to storage in a single merge. Called on the tick.
export async function persist(): Promise<void> {
  if (counting) accumulate();
  if (pending.size === 0) return;

  const snapshot = pending;
  pending = new Map();
  await update("usage", (usage) => {
    const next = { ...usage };
    for (const [key, day] of snapshot) {
      const target = { ...(next[key] ?? {}) };
      for (const [domain, buf] of Object.entries(day)) {
        const entry = target[domain];
        const paths = { ...entry?.paths };
        for (const [path, ms] of Object.entries(buf.paths)) {
          paths[path] = (paths[path] ?? 0) + ms;
        }
        target[domain] = { ms: (entry?.ms ?? 0) + buf.ms, paths };
      }
      next[key] = target;
    }
    return next;
  });
}

export function activeTabId(): number | null {
  return active?.tabId ?? null;
}
