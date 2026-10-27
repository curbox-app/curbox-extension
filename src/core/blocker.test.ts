import { describe, expect, it } from "vitest";
import { evaluate } from "./blocker";
import { dateKey } from "../lib/time";
import { defaultGentlePrompt, newGroup, type FocusLogEntry, type FocusSession, type Settings, type UsageHistory } from "../lib/types";

const NOW = new Date(2026, 7, 3, 10, 30).getTime();

function settingsFor(limitMinutes: number, ranges = [{ start: 9 * 60, end: 17 * 60 }]): Settings {
  const group = newGroup("Video");
  group.id = "video";
  group.matchers = ["youtube.com"];
  group.schedule.days = group.schedule.days.map(() => ({ active: true, limitMinutes, ranges }));
  return { schemaVersion: 2, groups: [group], focusGroups: [], gentlePrompt: defaultGentlePrompt() };
}

function decide(settings: Settings, usage: UsageHistory = {}, now = NOW, focus: FocusSession | null = null, focusLog: FocusLogEntry[] = []) {
  return evaluate({
    location: { domain: "youtube.com", path: "/watch" },
    settings,
    focus,
    usage,
    focusLog,
    now,
    grants: {},
    proceeds: {},
  });
}

describe("scheduled usage blocking", () => {
  it("blocks a zero limit inside active hours and allows the site outside them", () => {
    const settings = settingsFor(0);
    expect(decide(settings).reason).toBe("time");
    expect(decide(settings, {}, new Date(2026, 7, 3, 18).getTime()).blocked).toBe(false);
  });

  it("counts only hourly usage inside the current active window", () => {
    const settings = settingsFor(60);
    const key = dateKey(new Date(NOW));
    const buckets = Array(24).fill(0);
    buckets[8] = 45 * 60_000;
    buckets[10] = 30 * 60_000;
    const usage: UsageHistory = {
      [key]: { "youtube.com": { ms: 75 * 60_000, paths: { "/watch": 75 * 60_000 }, pathHours: { "/watch": buckets } } },
    };
    expect(decide(settings, usage).blocked).toBe(false);
    buckets[10] = 60 * 60_000;
    expect(decide(settings, usage).reason).toBe("usage");
  });

  it("supports an overnight active window", () => {
    const settings = settingsFor(0, [{ start: 22 * 60, end: 6 * 60 }]);
    expect(decide(settings, {}, new Date(2026, 7, 4, 2).getTime()).reason).toBe("time");
    expect(decide(settings, {}, new Date(2026, 7, 4, 8).getTime()).blocked).toBe(false);
  });

  it("requires the focus goal and merges overlapping completed and active time", () => {
    const settings = settingsFor(0);
    const warning = settings.groups[0].warning;
    warning.challenge = "wait";
    warning.focusGoalEnabled = true;
    warning.focusGoalGroupId = "deep";
    warning.focusGoalRequiredMinutes = 60;
    const focusLog: FocusLogEntry[] = [{
      at: NOW - 20 * 60_000,
      day: dateKey(new Date(NOW)),
      startedAt: NOW - 70 * 60_000,
      endedAt: NOW - 20 * 60_000,
      groupId: "deep",
      name: "Deep",
      plannedMs: 50 * 60_000,
      actualMs: 50 * 60_000,
      completed: true,
    }];
    const focus: FocusSession = {
      groupId: "deep",
      name: "Deep",
      domains: [],
      packages: [],
      mode: "only-these",
      startedAt: NOW - 30 * 60_000,
      endsAt: NOW + 30 * 60_000,
      exitable: true,
      plannedMs: 60 * 60_000,
    };
    const decision = decide(settings, {}, NOW, focus, focusLog);
    expect(decision.focusGoalRemainingMs).toBe(0);
    expect(decision.canProceed).toBe(true);
  });

  it("uses a sliding proceed-limit window", () => {
    const settings = settingsFor(0);
    settings.groups[0].warning.proceedLimit = 3;
    settings.groups[0].warning.proceedWindowMinutes = 60;
    const input = {
      location: { domain: "youtube.com", path: "/watch" },
      settings,
      focus: null,
      usage: {},
      focusLog: [],
      now: NOW,
      grants: {},
      proceeds: {
        video: {
          count: 3,
          windowStart: NOW - 59 * 60_000,
          timestamps: [NOW - 61 * 60_000, NOW - 30 * 60_000, NOW - 1_000],
        },
      },
    };
    expect(evaluate(input).canProceed).toBe(true);
    input.proceeds.video.timestamps[0] = NOW - 59 * 60_000;
    expect(evaluate(input).canProceed).toBe(false);
  });
});
