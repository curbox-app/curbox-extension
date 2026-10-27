import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeBrowser } from "@webext-core/fake-browser";
import { currentRound, newPomodoro, nextPhase, normalizePomodoro, phaseMs } from "./pomodoro";
import { activeSession, endSession, startSession } from "./focus";
import { evaluate } from "./blocker";
import { get } from "../lib/storage";
import { normalizeSettings, newFocusGroup, type FocusSession } from "../lib/types";

describe("pomodoro state (mirrors Android PomodoroState)", () => {
  it("clamps to Android's limits", () => {
    const state = normalizePomodoro({ phase: "focus", focusMinutes: 0, breakMinutes: 500, totalRounds: 99, completedRounds: -3 });
    expect(state).toEqual({ phase: "focus", focusMinutes: 1, breakMinutes: 120, totalRounds: 12, completedRounds: 0 });
    expect(newPomodoro(25, 5, 1).totalRounds).toBe(2);
  });

  it("alternates focus and break, then ends after the last focus round", () => {
    let state = newPomodoro(25, 5, 2);
    expect(currentRound(state)).toBe(1);
    expect(phaseMs(state)).toBe(25 * 60_000);

    state = nextPhase(state)!;
    expect(state).toMatchObject({ phase: "break", completedRounds: 1 });
    expect(phaseMs(state)).toBe(5 * 60_000);

    state = nextPhase(state)!;
    expect(state).toMatchObject({ phase: "focus", completedRounds: 1 });
    expect(currentRound(state)).toBe(2);

    expect(nextPhase(state)).toBeNull();
  });
});

describe("pomodoro sessions", () => {
  const group = { ...newFocusGroup("Work"), domains: ["youtube.com"] };
  const yt = { domain: "youtube.com", path: "" };
  const blocked = (focus: FocusSession | null) =>
    evaluate({ location: yt, settings: normalizeSettings({}), focus, usage: {}, focusLog: [], now: Date.now(), grants: {}, proceeds: {} }).blocked;

  beforeEach(() => {
    fakeBrowser.reset();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 5, 15, 9, 0));
  });
  afterEach(() => vi.useRealTimers());

  it("blocks during focus, opens up on the break, and logs each focus round", async () => {
    await startSession(group, 25, true, { breakMinutes: 5, rounds: 2 });
    expect(blocked(await activeSession())).toBe(true);

    vi.advanceTimersByTime(25 * 60_000);
    const onBreak = await activeSession();
    expect(onBreak?.pomodoro).toMatchObject({ phase: "break", completedRounds: 1 });
    expect(onBreak!.endsAt - Date.now()).toBe(5 * 60_000);
    expect(blocked(onBreak)).toBe(false);
    expect(await get("focusLog")).toHaveLength(1);

    vi.advanceTimersByTime(5 * 60_000);
    const second = await activeSession();
    expect(second?.pomodoro?.phase).toBe("focus");
    expect(blocked(second)).toBe(true);
    expect(await get("focusLog")).toHaveLength(1);

    vi.advanceTimersByTime(25 * 60_000);
    expect(await activeSession()).toBeNull();
    const log = await get("focusLog");
    expect(log).toHaveLength(2);
    expect(log.every((entry) => entry.completed && entry.actualMs === 25 * 60_000)).toBe(true);
  });

  it("ending during a break logs nothing more", async () => {
    await startSession(group, 25, true, { breakMinutes: 5, rounds: 4 });
    vi.advanceTimersByTime(25 * 60_000);
    await activeSession();
    vi.advanceTimersByTime(60_000);
    await endSession();
    expect(await get("focus")).toBeNull();
    expect(await get("focusLog")).toHaveLength(1);
  });

  it("ending mid focus logs an unfinished round", async () => {
    await startSession(group, 25, true, { breakMinutes: 5, rounds: 4 });
    vi.advanceTimersByTime(10 * 60_000);
    await endSession();
    const [entry] = await get("focusLog");
    expect(entry).toMatchObject({ completed: false, actualMs: 10 * 60_000 });
  });

  it("a plain session still ends after its time", async () => {
    await startSession(group, 30, true);
    vi.advanceTimersByTime(30 * 60_000);
    expect(await activeSession()).toBeNull();
    expect(await get("focusLog")).toHaveLength(1);
  });
});
