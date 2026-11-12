import { describe, expect, it } from "vitest";
import { decide, INACTIVE, localView, phoneView, sameFocus, settling, type FocusView } from "./reconcile";

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

describe("lan pomodoro reconcile", () => {
  const now = 1_000_000;
  const session = (phase: "focus" | "break", completedRounds: number) => ({
    groupId: "g1", name: "Study", domains: [], packages: [], mode: "only-these" as const,
    startedAt: now, endsAt: now + 300_000, exitable: true, plannedMs: 300_000,
    pomodoro: { phase, focusMinutes: 25, breakMinutes: 5, totalRounds: 4, completedRounds },
  });

  it("hides breaks from a phone that cannot run cycles", () => {
    expect(localView(session("break", 1), now, false)).toEqual(INACTIVE);
    expect(localView(session("break", 1), now, true)).toMatchObject({ active: true, phase: "break", pomodoro: { completed: 1, rounds: 4 } });
  });

  it("tells phases and rounds apart", () => {
    const a = localView(session("focus", 1), now, true);
    expect(sameFocus(a, localView(session("break", 1), now, true))).toBe(false);
    expect(sameFocus(a, localView(session("focus", 2), now, true))).toBe(false);
    expect(sameFocus(a, { ...study(now + 300_000), phase: undefined })).toBe(true);
  });

  it("reads the cycle from a phone", () => {
    const phone = {
      connected: true, apiVersion: 7, active: true, groupId: "g1", name: "Study", endsAt: now + 300_000, exitable: true,
      exact: true, changedAt: now, rev: 2, groups: [], caps: ["pomodoro"], phase: "break" as const,
      pomodoro: { phase: "break", focusMinutes: 25, breakMinutes: 5, rounds: 4, completed: 1 },
    };
    expect(sameFocus(phoneView(phone, now), localView(session("break", 1), now, true))).toBe(true);
  });

  it("waits while a phase is ending", () => {
    expect(settling(study(now + 5_000), now)).toBe(true);
    expect(settling(study(now + 60_000), now)).toBe(false);
  });
});
