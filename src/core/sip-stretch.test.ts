import { describe, expect, it } from "vitest";
import { countSpan, IDLE_SIP_STRETCH } from "./sip-stretch";
import { evaluate } from "./blocker";
import { defaultSipStretch, normalizeSettings } from "../lib/types";

const MIN = 60_000;
const NOW = new Date(2026, 10, 12, 10).getTime();
const config = { ...defaultSipStretch(), enabled: true, sites: ["youtube.com"], usageLimitMinutes: 30, breakMinutes: 5 };

describe("sip and stretch count", () => {
  it("adds time on the chosen sites and starts a break at the limit", () => {
    const halfway = countSpan(IDLE_SIP_STRETCH, config, NOW, NOW + 20 * MIN);
    expect(halfway).toEqual({ usedMs: 20 * MIN, lastAt: NOW + 20 * MIN, breakEndsAt: 0 });
    const done = countSpan(halfway, config, NOW + 20 * MIN, NOW + 30 * MIN);
    expect(done).toEqual({ usedMs: 0, lastAt: 0, breakEndsAt: NOW + 35 * MIN });
  });

  it("starts over after a rest as long as one break", () => {
    const used = countSpan(IDLE_SIP_STRETCH, config, NOW, NOW + 20 * MIN);
    expect(countSpan(used, config, NOW + 24 * MIN, NOW + 25 * MIN).usedMs).toBe(21 * MIN);
    expect(countSpan(used, config, NOW + 25 * MIN, NOW + 26 * MIN).usedMs).toBe(MIN);
  });

  it("ignores time during a break and starts fresh after it", () => {
    const onBreak = { usedMs: 0, lastAt: 0, breakEndsAt: NOW + 5 * MIN };
    expect(countSpan(onBreak, config, NOW + MIN, NOW + 2 * MIN)).toBe(onBreak);
    expect(countSpan({ ...onBreak, usedMs: 10 * MIN }, config, NOW + 6 * MIN, NOW + 7 * MIN).usedMs).toBe(MIN);
  });
});

describe("sip and stretch break", () => {
  const settings = { ...normalizeSettings({}), sipStretch: config };
  const decide = (breakEndsAt: number, enabled = true) =>
    evaluate({
      location: { domain: "example.com", path: "" },
      settings: { ...settings, sipStretch: { ...config, enabled } },
      focus: null,
      usage: {},
      focusLog: [],
      now: NOW,
      grants: {},
      proceeds: {},
      sipStretch: { usedMs: 0, lastAt: 0, breakEndsAt },
    });

  it("blocks every site until the break ends", () => {
    expect(decide(NOW + MIN)).toMatchObject({ blocked: true, source: "break", breakEndsAt: NOW + MIN });
    expect(decide(NOW).blocked).toBe(false);
    expect(decide(NOW + MIN, false).blocked).toBe(false);
  });
});
