import type { FocusSession } from "../types";

// Focus as both sides see it, reduced to what has to agree.
export interface FocusView {
  active: boolean;
  groupId: string;
  name: string;
  endsAt: number;
}

export interface PhoneGroup {
  id: string;
  name: string;
  exitable: boolean;
  blockMode?: string;
}

export interface PhoneState extends FocusView {
  connected: boolean;
  apiVersion: number;
  exitable: boolean;
  exact: boolean;
  changedAt: number;
  rev: number;
  groups: PhoneGroup[];
}

export const INACTIVE: FocusView = { active: false, groupId: "", name: "", endsAt: 0 };
// Older Curbox only reports whole minutes left, so ends can differ by this much.
export const END_TOLERANCE_MS = 90_000;

export function localView(session: FocusSession | null, now = Date.now()): FocusView {
  if (!session || session.endsAt <= now || session.pomodoro?.phase === "break") return INACTIVE;
  return { active: true, groupId: session.groupId, name: session.name, endsAt: session.endsAt };
}

export function phoneView(phone: PhoneState, now = Date.now()): FocusView {
  if (!phone.active || phone.endsAt <= now) return INACTIVE;
  return { active: true, groupId: phone.groupId, name: phone.name, endsAt: phone.endsAt };
}

const norm = (name: string) => name.trim().toLowerCase();

export function sameGroup(a: { groupId?: string; id?: string; name: string }, b: { groupId?: string; id?: string; name: string }): boolean {
  const idA = a.groupId ?? a.id ?? "";
  const idB = b.groupId ?? b.id ?? "";
  return (idA !== "" && idA === idB) || (norm(a.name) !== "" && norm(a.name) === norm(b.name));
}

export function sameFocus(a: FocusView, b: FocusView): boolean {
  if (!a.active || !b.active) return a.active === b.active;
  return sameGroup(a, b) && Math.abs(a.endsAt - b.endsAt) <= END_TOLERANCE_MS;
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
