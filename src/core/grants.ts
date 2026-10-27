import { get, update } from "../lib/storage";
import type { SiteLocation } from "../lib/url";
import { matchingOnOpenGroups } from "./blocker";
import { compiledLists } from "./lists";

const DEFAULT_UNLOCK_MINUTES = 2;

export async function pruneGrants(): Promise<void> {
  const now = Date.now();
  await update("grants", (grants) =>
    Object.values(grants).every((until) => until > now)
      ? grants
      : Object.fromEntries(Object.entries(grants).filter(([, until]) => until > now)),
  );
}

// Proceeding unlocks the whole group for a while and counts against any cap.
// Dynamic warnings pass the minutes chosen on the screen; otherwise we use the preset.
export async function recordProceed(groupId: string, minutes?: number): Promise<void> {
  const now = Date.now();
  const settings = await get("settings");
  const group = settings.groups.find((g) => g.id === groupId);
  const unlockMinutes = group?.onEachOpen
    ? 24 * 60
    : minutes && minutes > 0
      ? minutes
      : (group?.warning.unlockMinutes ?? DEFAULT_UNLOCK_MINUTES);
  const grantMs = unlockMinutes * 60_000;

  await update("grants", (grants) => {
    const next: Record<string, number> = { [groupId]: now + grantMs };
    for (const [id, until] of Object.entries(grants)) {
      if (until > now) next[id] = until;
    }
    return next;
  });

  await update("proceeds", (proceeds) => {
    const record = proceeds[groupId];
    const windowMs = (group?.warning.proceedWindowMinutes ?? 60) * 60_000;
    const prior = record?.timestamps ?? (
      record && now - record.windowStart < windowMs
        ? Array(Math.max(0, record.count)).fill(record.windowStart)
        : []
    );
    const timestamps = prior.filter((timestamp) => now - timestamp < windowMs);
    timestamps.push(now);
    return {
      ...proceeds,
      [groupId]: { count: timestamps.length, windowStart: timestamps[0] ?? now, timestamps },
    };
  });
}

// Android keeps an on-each-open grant while the user stays inside any target in
// that group, and clears it only after leaving the group.
export async function clearExitedOnOpenGrants(location: SiteLocation | null): Promise<void> {
  const settings = await get("settings");
  const ids = settings.groups.filter((group) => group.onEachOpen).map((group) => group.id);
  if (ids.length === 0) return;
  const stillInside = new Set(location ? matchingOnOpenGroups(location, settings, await compiledLists()) : []);
  await update("grants", (grants) => {
    const leaving = ids.filter((id) => !stillInside.has(id) && id in grants);
    if (leaving.length === 0) return grants;
    const next = { ...grants };
    for (const id of leaving) delete next[id];
    return next;
  });
}
