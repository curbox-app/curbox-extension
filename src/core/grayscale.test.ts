import { describe, expect, it } from "vitest";
import { shouldGrayscale } from "./grayscale";
import { newGrayscaleGroup, normalizeSettings, type GrayscaleGroup } from "../lib/types";

const AT_10 = new Date(2026, 9, 27, 10, 0).getTime(); // Tuesday
const AT_20 = new Date(2026, 9, 27, 20, 0).getTime();
const YT = { domain: "youtube.com", path: "/watch" };

function settingsWith(group: GrayscaleGroup) {
  return normalizeSettings({ schemaVersion: 2, grayscaleGroups: [group] });
}

function workHours(): GrayscaleGroup {
  const group = newGrayscaleGroup("Video");
  group.sites = ["youtube.com"];
  group.schedule.days = group.schedule.days.map((day) => ({ ...day, ranges: [{ start: 9 * 60, end: 17 * 60 }] }));
  return group;
}

describe("grayscale filter", () => {
  it("grays matching sites only inside active hours", () => {
    const settings = settingsWith(workHours());
    expect(shouldGrayscale(YT, settings, AT_10)).toBe(true);
    expect(shouldGrayscale(YT, settings, AT_20)).toBe(false);
    expect(shouldGrayscale({ domain: "github.com", path: "" }, settings, AT_10)).toBe(false);
  });

  it("respects the group switch and inactive days", () => {
    expect(shouldGrayscale(YT, settingsWith({ ...workHours(), enabled: false }), AT_10)).toBe(false);
    const group = workHours();
    group.schedule.days[2] = { ...group.schedule.days[2], active: false };
    expect(shouldGrayscale(YT, settingsWith(group), AT_10)).toBe(false);
  });

  it("handles ranges that cross midnight", () => {
    const group = workHours();
    group.schedule.days = group.schedule.days.map((day) => ({ ...day, ranges: [{ start: 22 * 60, end: 2 * 60 }] }));
    expect(shouldGrayscale(YT, settingsWith(group), new Date(2026, 9, 28, 1, 0).getTime())).toBe(true);
    expect(shouldGrayscale(YT, settingsWith(group), AT_20)).toBe(false);
  });

  it("defaults to no groups for older settings", () => {
    expect(normalizeSettings({ schemaVersion: 2 }).grayscaleGroups).toEqual([]);
  });
});
