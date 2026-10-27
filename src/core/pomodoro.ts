import { POMODORO, type PomodoroState } from "../lib/types";

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, Math.floor(value) || min));

export function newPomodoro(focusMinutes: number, breakMinutes: number, rounds: number): PomodoroState {
  return normalizePomodoro({ phase: "focus", focusMinutes, breakMinutes, totalRounds: rounds, completedRounds: 0 });
}

export function normalizePomodoro(state: PomodoroState): PomodoroState {
  return {
    phase: state.phase === "break" ? "break" : "focus",
    focusMinutes: clamp(state.focusMinutes, 1, POMODORO.maxFocusMinutes),
    breakMinutes: clamp(state.breakMinutes, 1, POMODORO.maxBreakMinutes),
    totalRounds: clamp(state.totalRounds, POMODORO.minRounds, POMODORO.maxRounds),
    completedRounds: Math.max(0, Math.floor(state.completedRounds) || 0),
  };
}

/** The phase after this one, or null once the last focus round is done. */
export function nextPhase(state: PomodoroState): PomodoroState | null {
  const current = normalizePomodoro(state);
  if (current.phase === "break") return { ...current, phase: "focus" };
  const completedRounds = current.completedRounds + 1;
  if (completedRounds >= current.totalRounds) return null;
  return { ...current, phase: "break", completedRounds };
}

export function phaseMs(state: PomodoroState): number {
  const current = normalizePomodoro(state);
  return (current.phase === "break" ? current.breakMinutes : current.focusMinutes) * 60_000;
}

export function currentRound(state: PomodoroState): number {
  return Math.min(state.completedRounds + 1, state.totalRounds);
}

export const isOnBreak = (state: PomodoroState | undefined) => state?.phase === "break";
