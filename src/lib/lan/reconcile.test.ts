import { describe, expect, it } from "vitest";
import { decide, INACTIVE, sameFocus, type FocusView } from "./reconcile";

const study = (endsAt: number, groupId = "g1"): FocusView => ({ active: true, groupId, name: "Study", endsAt });

describe("lan focus reconcile", () => {
  it("treats close ends of the same group as equal", () => {
    expect(sameFocus(study(1_000_000), study(1_060_000, "other"))).toBe(true);
    expect(sameFocus(study(1_000_000), study(1_200_000))).toBe(false);
    expect(sameFocus(INACTIVE, INACTIVE)).toBe(true);
  });

  it("prefers an active phone on first contact", () => {
    expect(decide(INACTIVE, study(5), null, 0, 0)).toBe("pull");
    expect(decide(study(5), INACTIVE, null, 0, 0)).toBe("push");
  });

  it("pushes a local start and pulls a phone stop", () => {
    const last = { local: INACTIVE, phone: INACTIVE };
    expect(decide(study(1e6), INACTIVE, last, 10, 0)).toBe("push");
    const running = { local: study(1e6), phone: study(1e6) };
    expect(decide(study(1e6), INACTIVE, running, 0, 10)).toBe("pull");
  });

  it("stays put after an unresolved difference", () => {
    const last = { local: study(1e6), phone: INACTIVE };
    expect(decide(study(1e6), INACTIVE, last, 0, 0)).toBe("none");
  });

  it("lets the newer change win when both moved", () => {
    const last = { local: INACTIVE, phone: INACTIVE };
    expect(decide(study(1e6), study(9e6, "g2"), last, 20, 10)).toBe("push");
    expect(decide(study(1e6), study(9e6, "g2"), last, 10, 20)).toBe("pull");
  });
});
