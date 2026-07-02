import { browser } from "#imports";
import { update } from "../lib/storage";
import { addUsage, mergeUsage, sliceSpanByDay } from "../lib/usage-data";
import type { DateKey, DayUsage } from "../lib/types";
import type { SiteLocation } from "../lib/url";

export type MachineState = "active" | "idle" | "locked";

interface ActiveState {
  tabId: number;
  domain: string;
  path: string;
  since: number;
}

// Fallback only. The OS idle gate is the real defence against banking time
// while the user is away; this catches the one case it cannot: the process
// being frozen mid-life (system sleep, lid close, hibernation) so no idle
// event ever fires. On resume the next accumulate sees a gap far larger than
// any real tick (~30-60s, browsers clamp the alarm), proving the process was
// suspended, so that span is discarded rather than banked.
const SUSPEND_GAP_MS = 3 * 60_000;

const SNAPSHOT_KEY = "usageTracker";

// The full tracker state, mirrored to storage.session on every change.
// storage.session survives service worker restarts but is cleared on browser
// restart, exactly the lifetime this in-flight state needs. Where it is
// missing (older Firefox) the tracker still works and merely loses at most
// one tick of unpersisted time when the worker is torn down.
interface TrackerSnapshot {
  active: ActiveState | null;
  counting: boolean;
  windowFocused: boolean;
  pageVisible: boolean;
  machineState: MachineState;
  tabAudible: boolean;
  pending: Record<DateKey, DayUsage>;
}

interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface UsageTracker {
  startTracking(tabId: number, location: SiteLocation): Promise<void>;
  stopTracking(): Promise<void>;
  setWindowFocused(value: boolean): Promise<void>;
  setPageVisible(value: boolean): Promise<void>;
  setMachineState(value: MachineState): Promise<void>;
  setTabAudible(value: boolean): Promise<void>;
  persist(): Promise<void>;
  activeTabId(): number | null;
}

export function createUsageTracker(
  session: SessionArea | undefined = browser.storage?.session as SessionArea | undefined,
): UsageTracker {
  let active: ActiveState | null = null;
  let counting = false;
  let windowFocused = true;
  let pageVisible = true;
  // Mirrors chrome.idle: ground truth from the operating system, so a locked
  // screen or a user who walked away stops counting at once.
  let machineState: MachineState = "active";
  // Whether the tracked tab is playing sound. Sound proves passive use
  // (watching a video, listening to music) that the input-based idle detector
  // cannot see, so it keeps the clock running through an "idle" report.
  let tabAudible = false;

  // Unpersisted deltas, grouped day -> domain -> usage. Drained on each tick
  // so frequent tab/visibility changes only touch memory, never storage.local.
  let pending = new Map<DateKey, DayUsage>();

  // We only count while a tab is tracked, its window holds OS focus, the page
  // reports itself visible, and the user is present (or provably listening).
  function shouldCount(): boolean {
    if (!active || !windowFocused || !pageVisible) return false;
    if (machineState === "idle") return tabAudible;
    return machineState === "active";
  }

  function bank(key: DateKey, domain: string, path: string, ms: number): void {
    let day = pending.get(key);
    if (!day) pending.set(key, (day = {}));
    addUsage(day, domain, path, ms);
  }

  // Fold the time elapsed since the counting window opened into the buffer.
  // Only meaningful while counting: outside it the clock is not running, so
  // there is nothing to credit. Every positive span is kept, however small,
  // so rapid tab hops still add up honestly.
  function accumulate(): void {
    if (!active || !counting) return;
    const now = Date.now();
    const from = active.since;
    active.since = now;
    const ms = now - from;
    // <= 0 means the system clock moved backwards; beyond the gap means the
    // process was frozen and the span is not real usage.
    if (ms <= 0 || ms > SUSPEND_GAP_MS) return;
    for (const slice of sliceSpanByDay(from, now)) {
      bank(slice.key, active.domain, active.path, slice.ms);
    }
  }

  // Open or close the counting window as the gates change.
  function sync(): void {
    const should = shouldCount();
    if (should === counting) return;
    if (should) {
      if (active) active.since = Date.now();
      counting = true;
    } else {
      accumulate();
      counting = false;
    }
  }

  function snapshot(): void {
    if (!session) return;
    const state: TrackerSnapshot = {
      active,
      counting,
      windowFocused,
      pageVisible,
      machineState,
      tabAudible,
      pending: Object.fromEntries(pending),
    };
    void session.set({ [SNAPSHOT_KEY]: state }).catch(() => {});
  }

  async function restore(): Promise<void> {
    if (!session) return;
    try {
      const stored = (await session.get(SNAPSHOT_KEY))[SNAPSHOT_KEY] as TrackerSnapshot | undefined;
      if (!stored) return;
      active = stored.active;
      counting = stored.counting;
      windowFocused = stored.windowFocused;
      pageVisible = stored.pageVisible;
      machineState = stored.machineState;
      tabAudible = stored.tabAudible;
      pending = new Map(Object.entries(stored.pending ?? {}));
    } catch {
      // A fresh start only costs the last unpersisted tick.
    }
  }

  // Every mutation runs through one queue, so events that wake the worker are
  // applied after the restored state loads, in the order they happened. That
  // lets a revived worker credit the span it was counting when it was killed:
  // no browser event fired during the gap (any event would have woken it), so
  // the gates provably held for the whole span.
  let queue: Promise<unknown> = restore();
  function enqueue(fn: () => void | Promise<void>): Promise<void> {
    const run = queue.then(fn);
    queue = run.catch(() => {});
    return run;
  }

  function setGate(apply: (value: boolean) => void) {
    return (value: boolean) =>
      enqueue(() => {
        apply(value);
        sync();
        snapshot();
      });
  }

  async function doPersist(): Promise<void> {
    accumulate();
    if (pending.size === 0) {
      snapshot();
      return;
    }
    const drained = pending;
    pending = new Map();
    // Clear the mirror before writing, so a crash between the two writes can
    // only lose this one batch, never double count it.
    snapshot();
    try {
      await update("usage", (usage) => mergeUsage(usage, drained));
    } catch {
      // Put the batch back; the next tick retries.
      for (const [key, day] of drained) {
        for (const [domain, buf] of Object.entries(day)) {
          for (const [path, ms] of Object.entries(buf.paths)) bank(key, domain, path, ms);
        }
      }
      snapshot();
    }
  }

  return {
    startTracking: (tabId, location) =>
      enqueue(() => {
        accumulate();
        // Only a real tab switch resets visibility: the new tab is on screen
        // by definition, and some pages (the PDF viewer) never get a content
        // script to say so. A re-evaluation of the same tab must not
        // overwrite a genuinely hidden state.
        if (active?.tabId !== tabId) pageVisible = true;
        active = { tabId, domain: location.domain, path: location.path, since: Date.now() };
        counting = false;
        sync();
        snapshot();
      }),
    stopTracking: () =>
      enqueue(() => {
        accumulate();
        active = null;
        counting = false;
        snapshot();
      }),
    setWindowFocused: setGate((value) => (windowFocused = value)),
    setPageVisible: setGate((value) => (pageVisible = value)),
    setTabAudible: setGate((value) => (tabAudible = value)),
    setMachineState: (value) =>
      enqueue(() => {
        machineState = value;
        sync();
        snapshot();
      }),
    persist: () => enqueue(doPersist),
    activeTabId: () => active?.tabId ?? null,
  };
}

const tracker = createUsageTracker();

export const {
  startTracking,
  stopTracking,
  setWindowFocused,
  setPageVisible,
  setMachineState,
  setTabAudible,
  persist,
  activeTabId,
} = tracker;
