import { get, set, update } from "../lib/storage";
import { todayKey } from "../lib/time";
import type { FocusGroup, FocusSession } from "../lib/types";

export async function startSession(group: FocusGroup, durationMin: number, exitable: boolean): Promise<FocusSession> {
  const now = Date.now();
  const plannedMs = durationMin * 60_000;
  const session: FocusSession = {
    groupId: group.id,
    name: group.name,
    domains: group.domains,
    mode: group.mode,
    startedAt: now,
    endsAt: now + plannedMs,
    exitable,
    plannedMs,
  };
  await set("focus", session);
  return session;
}

async function logSession(focus: FocusSession, completed: boolean): Promise<void> {
  const now = Date.now();
  const actualMs = Math.max(0, Math.min(now, focus.endsAt) - focus.startedAt);
  await update("focusLog", (log) =>
    [
      {
        at: now,
        day: todayKey(),
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

export async function endSession(): Promise<void> {
  const focus = await get("focus");
  if (focus) await logSession(focus, Date.now() >= focus.endsAt);
  await set("focus", null);
}

export async function activeSession(): Promise<FocusSession | null> {
  const focus = await get("focus");
  if (!focus) return null;
  if (Date.now() >= focus.endsAt) {
    await logSession(focus, true);
    await set("focus", null);
    return null;
  }
  return focus;
}
