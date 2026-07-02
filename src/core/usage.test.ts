import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "@webext-core/fake-browser";
import { createUsageTracker } from "./usage";
import { get } from "../lib/storage";
import { dateKey } from "../lib/time";

const BASE = new Date(2026, 5, 15, 12, 0, 0).getTime();
const YT = { domain: "youtube.com", path: "/watch?v=abc" };

function advance(ms: number): void {
  vi.setSystemTime(Date.now() + ms);
}

function memorySession() {
  const store: Record<string, unknown> = {};
  return {
    async get(key: string) {
      return key in store ? { [key]: structuredClone(store[key]) } : {};
    },
    async set(items: Record<string, unknown>) {
      Object.assign(store, structuredClone(items));
    },
  };
}

async function domainMs(domain: string, key = dateKey(new Date())): Promise<number> {
  const usage = await get("usage");
  return usage[key]?.[domain]?.ms ?? 0;
}

describe("usage tracker", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.useFakeTimers();
    vi.setSystemTime(BASE);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("counts time while focused, visible, and active", async () => {
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    advance(10_000);
    await tracker.persist();
    expect(await domainMs("youtube.com")).toBe(10_000);
    const usage = await get("usage");
    expect(usage[dateKey(new Date())]["youtube.com"].paths["/watch?v=abc"]).toBe(10_000);
  });

  it("does not bank time while the window is unfocused, even when tracking restarts", async () => {
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    advance(5_000);
    await tracker.setWindowFocused(false);
    // The periodic tick re-evaluates the focused tab; that must never credit
    // the unfocused span.
    advance(30_000);
    await tracker.startTracking(1, YT);
    advance(30_000);
    await tracker.startTracking(1, YT);
    await tracker.persist();
    expect(await domainMs("youtube.com")).toBe(5_000);
  });

  it("keeps sub second spans", async () => {
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    advance(400);
    await tracker.setPageVisible(false);
    advance(5_000);
    await tracker.setPageVisible(true);
    advance(300);
    await tracker.setPageVisible(false);
    await tracker.persist();
    expect(await domainMs("youtube.com")).toBe(700);
  });

  it("keeps counting through OS idle while the tab is audible, but never through a lock", async () => {
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    await tracker.setTabAudible(true);
    await tracker.setMachineState("idle");
    advance(60_000);
    await tracker.setMachineState("locked");
    advance(60_000);
    await tracker.persist();
    expect(await domainMs("youtube.com")).toBe(60_000);
  });

  it("stops counting on OS idle when the tab is silent", async () => {
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    advance(5_000);
    await tracker.setMachineState("idle");
    advance(60_000);
    await tracker.persist();
    expect(await domainMs("youtube.com")).toBe(5_000);
  });

  it("splits a span that crosses local midnight across both days", async () => {
    vi.setSystemTime(new Date(2026, 5, 15, 23, 59, 30));
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    advance(60_000);
    await tracker.persist();
    const usage = await get("usage");
    expect(usage["2026-06-15"]["youtube.com"].ms).toBe(30_000);
    expect(usage["2026-06-16"]["youtube.com"].ms).toBe(30_000);
  });

  it("discards a span longer than the suspend gap", async () => {
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    advance(10 * 60_000);
    await tracker.persist();
    expect(await domainMs("youtube.com")).toBe(0);
  });

  it("never banks negative time when the clock moves backwards", async () => {
    const tracker = createUsageTracker(undefined);
    await tracker.startTracking(1, YT);
    vi.setSystemTime(BASE - 60_000);
    await tracker.persist();
    expect(await domainMs("youtube.com")).toBe(0);
  });

  it("recovers the in flight span from the session snapshot after a worker restart", async () => {
    const session = memorySession();
    const first = createUsageTracker(session);
    await first.startTracking(1, YT);
    advance(20_000);
    // The worker dies here without any teardown; a fresh instance restores.
    const revived = createUsageTracker(session);
    await revived.persist();
    expect(await domainMs("youtube.com")).toBe(20_000);
  });

  it("recovers banked but unpersisted deltas after a worker restart", async () => {
    const session = memorySession();
    const first = createUsageTracker(session);
    await first.startTracking(1, YT);
    advance(5_000);
    await first.setWindowFocused(false);
    const revived = createUsageTracker(session);
    await revived.persist();
    expect(await domainMs("youtube.com")).toBe(5_000);
  });
});
