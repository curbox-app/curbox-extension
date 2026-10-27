import { get, set, update } from "../lib/storage";
import { dateKey } from "../lib/time";
import type { FocusGroup, FocusSession } from "../lib/types";
import { isOnBreak, newPomodoro, nextPhase, phaseMs } from "./pomodoro";

export interface PomodoroChoice {
  breakMinutes: number;
  rounds: number;
}

let finalizeQueue: Promise<void> = Promise.resolve();

export async function startSession(
  group: FocusGroup,
  durationMin: number,
  exitable: boolean,
  pomodoroChoice?: PomodoroChoice | null,
): Promise<FocusSession> {
  const now = Date.now();
  const safeMinutes = Math.max(1, Math.floor(durationMin));
  const pomodoro = pomodoroChoice ? newPomodoro(safeMinutes, pomodoroChoice.breakMinutes, pomodoroChoice.rounds) : undefined;
  const plannedMs = Math.min(Number.MAX_SAFE_INTEGER - now, pomodoro ? phaseMs(pomodoro) : safeMinutes * 60_000);
  const session: FocusSession = {
    groupId: group.id,
    name: group.name,
    domains: group.domains,
    packages: group.packages ?? [],
    mode: group.mode,
    startedAt: now,
    endsAt: now + plannedMs,
    exitable,
    plannedMs,
    ...(pomodoro && { pomodoro }),
  };
  await set("focus", session);
  return session;
}

// Each focus round counts as its own session in the stats, like Android.
// Breaks are rest, so they are never logged.
async function logSession(focus: FocusSession, completed: boolean): Promise<void> {
  if (isOnBreak(focus.pomodoro)) return;
  const now = Date.now();
  const actualMs = Math.max(0, Math.min(now, focus.endsAt) - focus.startedAt);
  await update("focusLog", (log) =>
    [
      {
        at: now,
        day: dateKey(new Date(focus.startedAt)),
        startedAt: focus.startedAt,
        endedAt: Math.min(now, focus.endsAt),
        groupId: focus.groupId,
        name: focus.name,
        plannedMs: focus.plannedMs,
        actualMs,
        completed,
      },
      ...log,
    ].slice(0, 500),
  );
}

// Only acts on the phase it was asked about, so a second caller racing on the
// same expiry cannot end or skip a phase twice.
function settle(expected: FocusSession, next: (focus: FocusSession) => Promise<void>): Promise<void> {
  const run = finalizeQueue.then(async () => {
    const focus = await get("focus");
    if (!focus || focus.startedAt !== expected.startedAt) return;
    await next(focus);
  });
  finalizeQueue = run.catch(() => undefined);
  return run;
}

function finalizeSession(expected: FocusSession): Promise<void> {
  return settle(expected, async (focus) => {
    await logSession(focus, Date.now() >= focus.endsAt);
    await set("focus", null);
  });
}

function advancePomodoro(expected: FocusSession): Promise<void> {
  return settle(expected, async (focus) => {
    await logSession(focus, true);
    const next = focus.pomodoro && nextPhase(focus.pomodoro);
    if (!next) return set("focus", null);
    const now = Date.now();
    const plannedMs = phaseMs(next);
    await set("focus", { ...focus, pomodoro: next, startedAt: now, endsAt: now + plannedMs, plannedMs });
  });
}

export async function endSession(): Promise<void> {
  const focus = await get("focus");
  if (focus) await finalizeSession(focus);
}

export async function activeSession(): Promise<FocusSession | null> {
  const focus = await get("focus");
  if (!focus) return null;
  if (Date.now() < focus.endsAt) return focus;
  if (!focus.pomodoro) {
    await finalizeSession(focus);
    return null;
  }
  // Like Android, the next phase starts now rather than catching up on time
  // the browser spent asleep.
  await advancePomodoro(focus);
  return get("focus");
}
