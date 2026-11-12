import type { FocusGroup, FocusMode } from "../types";
import type { PhoneGroup } from "./reconcile";

// Focus group sharing with Curbox on the phone (proto 3, Curbox API 7). Each
// side keeps its own copy; the last agreed copy of every linked pair lets a
// round tell who changed what, so edits merge and deletions carry over.

/** The fields both sides hold for a focus group. Apps and Do Not Disturb stay on the phone. */
export interface SharedGroup {
  name: string;
  mode: FocusMode;
  exitable: boolean;
  websites: string[];
}

export interface GroupLink {
  localId: string;
  phoneId: string;
  base: SharedGroup;
}

export interface GroupEdit {
  id: string;
  name: string;
  websites: string[];
  blockMode: "BLOCK_SELECTED" | "BLOCK_ALL_EXCEPT_SELECTED";
  exitable: boolean;
}

export interface GroupPlan {
  /** Local groups to create or overwrite (by id), keeping their other fields. */
  upsert: FocusGroup[];
  /** Local group ids to remove. */
  remove: string[];
  save: GroupEdit[];
  /** Phone group ids to remove. */
  delete: string[];
  /** Links to keep if every phone change applies; see [settle]. */
  links: GroupLink[];
  /** Phone id of each pushed group, so a failed push keeps its old base. */
  pending: Record<string, GroupLink | null>;
}

const toMode = (blockMode: string | undefined): FocusMode => (blockMode === "BLOCK_ALL_EXCEPT_SELECTED" ? "all-except" : "only-these");
const toBlockMode = (mode: FocusMode) => (mode === "all-except" ? "BLOCK_ALL_EXCEPT_SELECTED" : "BLOCK_SELECTED");
const norm = (name: string) => name.trim().toLowerCase();

export function cleanSites(sites: readonly string[]): string[] {
  return [...new Set(sites.map((s) => s.trim()).filter(Boolean))].sort();
}

export const fromLocal = (g: FocusGroup): SharedGroup => ({ name: g.name.trim(), mode: g.mode, exitable: g.exitable, websites: cleanSites(g.domains) });
export const fromPhone = (g: PhoneGroup): SharedGroup => ({
  name: g.name.trim(),
  mode: toMode(g.blockMode),
  exitable: g.exitable,
  websites: cleanSites(g.websites ?? []),
});

export function sameShared(a: SharedGroup, b: SharedGroup): boolean {
  return a.name === b.name && a.mode === b.mode && a.exitable === b.exitable && a.websites.join("\n") === b.websites.join("\n");
}

/** A cheap fingerprint of the local groups, to skip rounds where nothing changed. */
export function localGroupsHash(groups: readonly FocusGroup[]): string {
  const text = [...groups].sort((a, b) => a.id.localeCompare(b.id)).map((g) => JSON.stringify([g.id, fromLocal(g)])).join("\n");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(16);
}

/**
 * Three way merge. Sites added on either side are kept, sites removed on either
 * side are dropped. A field changed on one side takes that side's value; when
 * both changed it, this browser's value wins.
 */
export function merge(base: SharedGroup | null, local: SharedGroup, phone: SharedGroup): SharedGroup {
  if (!base) {
    // First meeting of two groups with the same name: keep everything from both.
    return { ...phone, websites: cleanSites([...local.websites, ...phone.websites]) };
  }
  const pick = <K extends keyof SharedGroup>(k: K) => (local[k] !== base[k] ? local[k] : phone[k]);
  const had = new Set(base.websites);
  const inLocal = new Set(local.websites);
  const inPhone = new Set(phone.websites);
  const websites = cleanSites([...local.websites, ...phone.websites].filter((s) => (inLocal.has(s) && inPhone.has(s)) || !had.has(s)));
  return { name: pick("name"), mode: pick("mode"), exitable: pick("exitable"), websites };
}

const edit = (id: string, g: SharedGroup): GroupEdit => ({ id, name: g.name, websites: g.websites, blockMode: toBlockMode(g.mode), exitable: g.exitable });

function applyLocal(id: string, g: SharedGroup, existing: FocusGroup | undefined): FocusGroup {
  return existing
    ? { ...existing, name: g.name, mode: g.mode, exitable: g.exitable, domains: g.websites }
    : { id, name: g.name, mode: g.mode, exitable: g.exitable, domains: g.websites, packages: [], autoTurnOnDnd: false };
}

/**
 * Plans one sharing round. [frozen] holds group ids (on either side) that must
 * not change right now, such as the group of a session that cannot be ended early.
 */
export function planGroups(
  locals: readonly FocusGroup[],
  phones: readonly PhoneGroup[],
  links: readonly GroupLink[] | null,
  frozen: ReadonlySet<string> = new Set(),
): GroupPlan {
  const plan: GroupPlan = { upsert: [], remove: [], save: [], delete: [], links: [], pending: {} };
  const localById = new Map(locals.map((g) => [g.id, g]));
  const phoneById = new Map(phones.map((g) => [g.id, g]));
  let known = (links ?? []).filter((l) => localById.has(l.localId) || phoneById.has(l.phoneId));

  // Switching to another Curbox, or a wiped browser, looks like everything was
  // deleted at once. Start over instead of deleting the other side's groups.
  const goneLocal = known.filter((l) => !localById.has(l.localId)).length;
  const gonePhone = known.filter((l) => !phoneById.has(l.phoneId)).length;
  if (known.length >= 2 && (goneLocal * 2 > known.length || gonePhone * 2 > known.length)) known = [];

  const usedLocal = new Set(known.map((l) => l.localId));
  const usedPhone = new Set(known.map((l) => l.phoneId));
  const pairs: { local?: FocusGroup; phone?: PhoneGroup; link?: GroupLink }[] = known.map((link) => ({
    link,
    local: localById.get(link.localId),
    phone: phoneById.get(link.phoneId),
  }));
  for (const local of locals) {
    if (usedLocal.has(local.id)) continue;
    const phone =
      phones.find((p) => !usedPhone.has(p.id) && p.id === local.id) ??
      phones.find((p) => !usedPhone.has(p.id) && norm(p.name) !== "" && norm(p.name) === norm(local.name));
    if (phone) usedPhone.add(phone.id);
    usedLocal.add(local.id);
    pairs.push({ local, phone });
  }
  for (const phone of phones) if (!usedPhone.has(phone.id)) pairs.push({ phone });

  for (const { local, phone, link } of pairs) {
    const base = link?.base ?? null;
    const l = local && fromLocal(local);
    const p = phone && fromPhone(phone);
    const keep = () => link && plan.links.push(link);
    if ((local && frozen.has(local.id)) || (phone && frozen.has(phone.id))) {
      keep();
      continue;
    }
    if (l && p) {
      const merged = merge(base, l, p);
      const next: GroupLink = { localId: local!.id, phoneId: phone!.id, base: merged };
      if (!sameShared(merged, l)) plan.upsert.push(applyLocal(local!.id, merged, local));
      if (!sameShared(merged, p)) {
        plan.save.push(edit(phone!.id, merged));
        plan.pending[phone!.id] = link ?? null;
      }
      plan.links.push(next);
    } else if (l) {
      if (base && sameShared(base, l)) {
        // Removed on the phone and left alone here.
        plan.remove.push(local!.id);
        continue;
      }
      // New here, or edited here after the phone removed it: (re)create it there.
      plan.save.push(edit(local!.id, l));
      plan.pending[local!.id] = null;
      plan.links.push({ localId: local!.id, phoneId: local!.id, base: l });
    } else if (p) {
      if (base && sameShared(base, p)) {
        plan.delete.push(phone!.id);
        plan.pending[phone!.id] = link ?? null;
        continue;
      }
      plan.upsert.push(applyLocal(phone!.id, p, undefined));
      plan.links.push({ localId: phone!.id, phoneId: phone!.id, base: p });
    }
  }
  return plan;
}

/**
 * Keeps the new link for every phone change that applied. A change the phone
 * refused keeps its old link, so the next round tries it again.
 */
export function settle(plan: GroupPlan, results: Record<string, string>): GroupLink[] {
  const ok = (id: string) => results[id] === "applied" || results[id] === "noop";
  const links = plan.links.flatMap((link) => {
    if (!(link.phoneId in plan.pending) || ok(link.phoneId)) return [link];
    const old = plan.pending[link.phoneId];
    return old ? [old] : [];
  });
  // A refused delete keeps its link so the removal is tried again.
  for (const id of plan.delete) {
    const old = plan.pending[id];
    if (!ok(id) && old) links.push(old);
  }
  return links;
}
