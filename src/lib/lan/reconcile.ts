import type { FocusSession } from "../types";

/** A Pomodoro cycle as both sides describe it. `completed` counts finished focus rounds. */
export interface CycleView {
  focusMinutes: number;
  breakMinutes: number;
  rounds: number;
  completed: number;
}

// Focus as both sides see it, reduced to what has to agree.
export interface FocusView {
  active: boolean;
  groupId: string;
  name: string;
  endsAt: number;
  /** Proto 3 with Curbox API 7: "break" while a cycle rests, "focus" otherwise, "" when off. */
  phase?: "focus" | "break" | "";
  pomodoro?: CycleView;
}

export interface PhoneGroup {
  id: string;
  name: string;
  exitable: boolean;
  blockMode?: string;
  apps?: number;
  /** Only in `groups` and `saveGroups` replies. */
  websites?: string[];
}

export interface PhoneState extends FocusView {
  connected: boolean;
  apiVersion: number;
  exitable: boolean;
  exact: boolean;
  changedAt: number;
  rev: number;
  groups: PhoneGroup[];
  /** Proto 3: what this phone can share ("pomodoro", "groups"). */
  caps?: string[];
  /** Proto 3: changes whenever a group's name, mode, exit rule or websites change. */
  groupsHash?: string;
  /** Proto 3 phones send the cycle with its phase. */
  pomodoro?: CycleView & { phase?: string };
}

export const INACTIVE: FocusView = { active: false, groupId: "", name: "", endsAt: 0 };
// Older Curbox only reports whole minutes left, so ends can differ by this much.
export const END_TOLERANCE_MS = 90_000;
/** Around a phase or session end both sides move on their own; wait instead of pushing. */
export const SETTLE_MS = 15_000;

export const hasCap = (phone: PhoneState | null | undefined, cap: string) => !!phone?.caps?.includes(cap);

/**
 * The browser session as the phone should see it. A phone that cannot run a cycle
 * gets the focus rounds only, so its blocking stops during breaks.
 */
export function localView(session: FocusSession | null, now = Date.now(), cycles = false): FocusView {
  if (!session || session.endsAt <= now) return INACTIVE;
  const onBreak = session.pomodoro?.phase === "break";
  if (onBreak && !cycles) return INACTIVE;
  const view: FocusView = { active: true, groupId: session.groupId, name: session.name, endsAt: session.endsAt };
  if (!cycles) return view;
  const p = session.pomodoro;
  if (!p) return { ...view, phase: "focus" };
  return {
    ...view,
    phase: onBreak ? "break" : "focus",
    pomodoro: { focusMinutes: p.focusMinutes, breakMinutes: p.breakMinutes, rounds: p.totalRounds, completed: p.completedRounds },
  };
}

export function phoneView(phone: PhoneState, now = Date.now()): FocusView {
  if (!phone.active || phone.endsAt <= now) return INACTIVE;
  const view: FocusView = { active: true, groupId: phone.groupId, name: phone.name, endsAt: phone.endsAt };
  if (!hasCap(phone, "pomodoro")) return view;
  const p = phone.pomodoro;
  if (!p || !(p.rounds > 0)) return { ...view, phase: "focus" };
  return {
    ...view,
    phase: phone.phase === "break" ? "break" : "focus",
    pomodoro: { focusMinutes: p.focusMinutes, breakMinutes: p.breakMinutes, rounds: p.rounds, completed: p.completed },
  };
}

const norm = (name: string) => name.trim().toLowerCase();

export function sameGroup(a: { groupId?: string; id?: string; name: string }, b: { groupId?: string; id?: string; name: string }): boolean {
  const idA = a.groupId ?? a.id ?? "";
  const idB = b.groupId ?? b.id ?? "";
  return (idA !== "" && idA === idB) || (norm(a.name) !== "" && norm(a.name) === norm(b.name));
}

function sameCycle(a: CycleView | undefined, b: CycleView | undefined): boolean {
  if (!a || !b) return !a && !b;
  return a.focusMinutes === b.focusMinutes && a.breakMinutes === b.breakMinutes && a.rounds === b.rounds && a.completed === b.completed;
}

export function sameFocus(a: FocusView, b: FocusView): boolean {
  if (!a.active || !b.active) return a.active === b.active;
  if (!sameGroup(a, b) || Math.abs(a.endsAt - b.endsAt) > END_TOLERANCE_MS) return false;
  // Only compare cycles when both sides speak them (a view from an older peer has no phase).
  if (a.phase === undefined || b.phase === undefined) return true;
  return a.phase === b.phase && sameCycle(a.pomodoro, b.pomodoro);
}

/** True while a session or phase is ending, when both devices are about to move by themselves. */
export function settling(view: FocusView, now = Date.now()): boolean {
  return view.active && Math.abs(view.endsAt - now) < SETTLE_MS;
}

export type Action = "none" | "push" | "pull";

/**
 * Decides which side moved since the last agreed state. When both moved, the
 * newer change wins.
 */
export function decide(
  local: FocusView,
  phone: FocusView,
  last: { local: FocusView; phone: FocusView } | null,
  localChangedAt: number,
  phoneChangedAt: number,
): Action {
  if (sameFocus(local, phone)) return "none";
  if (!last) return phone.active ? "pull" : "push";
  const localMoved = !sameFocus(local, last.local);
  const phoneMoved = !sameFocus(phone, last.phone);
  if (localMoved && phoneMoved) return localChangedAt >= phoneChangedAt ? "push" : "pull";
  if (localMoved) return "push";
  if (phoneMoved) return "pull";
  return "none";
}
