import { get, update } from "../lib/storage";
import type { SiteLocation } from "../lib/url";
import { matchingOnOpenGroups } from "./blocker";

const DEFAULT_UNLOCK_MINUTES = 15;

export async function pruneGrants(): Promise<void> {
  const now = Date.now();
  await update("grants", (grants) =>
    Object.fromEntries(Object.entries(grants).filter(([, until]) => until > now)),
  );
}

// Proceeding unlocks the whole group for a while and counts against any cap.
// Dynamic warnings pass the minutes chosen on the screen; otherwise we use the preset.
export async function recordProceed(groupId: string, minutes?: number): Promise<void> {
  const now = Date.now();
  const settings = await get("settings");
  const group = settings.groups.find((g) => g.id === groupId);
  const unlockMinutes = minutes && minutes > 0 ? minutes : (group?.warning.unlockMinutes ?? DEFAULT_UNLOCK_MINUTES);
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
    const fresh = record && now - record.windowStart < windowMs;
    return {
      ...proceeds,
      [groupId]: fresh
        ? { count: record!.count + 1, windowStart: record!.windowStart }
        : { count: 1, windowStart: now },
    };
  });
}

// On a real navigation, "on each open" groups should block again, so drop their grant.
export async function clearOnOpenGrants(location: SiteLocation): Promise<void> {
  const settings = await get("settings");
  const ids = matchingOnOpenGroups(location, settings);
  if (ids.length === 0) return;
  await update("grants", (grants) => {
    const next = { ...grants };
    for (const id of ids) delete next[id];
    return next;
  });
}
