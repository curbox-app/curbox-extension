import { describe, expect, it } from "vitest";
import type { FocusGroup } from "../types";
import { fromLocal, merge, planGroups, settle, type SharedGroup } from "./groups";
import type { PhoneGroup } from "./reconcile";

const local = (id: string, name: string, domains: string[], extra: Partial<FocusGroup> = {}): FocusGroup => ({
  id, name, domains, mode: "only-these", exitable: true, packages: [], autoTurnOnDnd: false, ...extra,
});
const phone = (id: string, name: string, websites: string[], extra: Partial<PhoneGroup> = {}): PhoneGroup => ({
  id, name, websites, exitable: true, blockMode: "BLOCK_SELECTED", apps: 0, ...extra,
});
const shared = (websites: string[], name = "Study"): SharedGroup => ({ name, mode: "only-these", exitable: true, websites });

describe("lan focus group sharing", () => {
  it("keeps sites added on either side and drops sites removed on either side", () => {
    const base = shared(["a.com", "b.com", "c.com"]);
    const merged = merge(base, shared(["a.com", "b.com", "x.com"]), shared(["b.com", "c.com", "y.com"]));
    expect(merged.websites).toEqual(["b.com", "x.com", "y.com"]);
  });

  it("joins same named groups the first time they meet", () => {
    const plan = planGroups([local("e1", "Study", ["a.com"])], [phone("p1", "study", ["b.com"])], null);
    expect(plan.upsert[0]).toMatchObject({ id: "e1", domains: ["a.com", "b.com"] });
    expect(plan.save[0]).toMatchObject({ id: "p1", websites: ["a.com", "b.com"] });
    expect(plan.links).toHaveLength(1);
  });

  it("copies groups that only one side has", () => {
    const plan = planGroups([local("e1", "Read", ["a.com"])], [phone("p1", "Work", ["w.com"], { blockMode: "BLOCK_ALL_EXCEPT_SELECTED" })], null);
    expect(plan.save).toEqual([{ id: "e1", name: "Read", websites: ["a.com"], blockMode: "BLOCK_SELECTED", exitable: true }]);
    expect(plan.upsert).toEqual([expect.objectContaining({ id: "p1", name: "Work", mode: "all-except", domains: ["w.com"] })]);
  });

  it("keeps the phone only fields of a local group", () => {
    const g = local("e1", "Study", ["a.com"], { packages: ["com.app"], autoTurnOnDnd: true });
    const links = [{ localId: "e1", phoneId: "e1", base: fromLocal(g) }];
    const plan = planGroups([g], [phone("e1", "Study", ["a.com", "n.com"])], links);
    expect(plan.upsert[0]).toMatchObject({ packages: ["com.app"], autoTurnOnDnd: true, domains: ["a.com", "n.com"] });
    expect(plan.save).toEqual([]);
  });

  it("carries deletions over once both sides agreed", () => {
    const a = local("a", "A", ["a.com"]);
    const b = local("b", "B", ["b.com"]);
    const c = local("c", "C", ["c.com"]);
    const links = [a, b, c].map((g) => ({ localId: g.id, phoneId: g.id, base: fromLocal(g) }));
    const phones = [phone("a", "A", ["a.com"]), phone("b", "B", ["b.com"])];
    expect(planGroups([a, b, c], phones, links).remove).toEqual(["c"]);
    expect(planGroups([a, b], [...phones, phone("c", "C", ["c.com"])], links).delete).toEqual(["c"]);
  });

  it("does not delete everything when the other side looks wiped", () => {
    const groups = [local("a", "A", []), local("b", "B", []), local("c", "C", [])];
    const links = groups.map((g) => ({ localId: g.id, phoneId: g.id, base: fromLocal(g) }));
    const plan = planGroups(groups, [], links);
    expect(plan.remove).toEqual([]);
    expect(plan.save.map((s) => s.id)).toEqual(["a", "b", "c"]);
  });

  it("leaves a locked group alone and retries a refused edit", () => {
    const g = local("e1", "Study", ["a.com"]);
    const links = [{ localId: "e1", phoneId: "e1", base: fromLocal(g) }];
    const edited = { ...g, domains: ["a.com", "b.com"] };
    expect(planGroups([edited], [phone("e1", "Study", ["a.com"])], links, new Set(["e1"])).save).toEqual([]);
    const plan = planGroups([edited], [phone("e1", "Study", ["a.com"])], links);
    expect(plan.save).toHaveLength(1);
    expect(settle(plan, { e1: "locked" })).toEqual(links);
    expect(settle(plan, { e1: "applied" })[0].base.websites).toEqual(["a.com", "b.com"]);
  });
});
