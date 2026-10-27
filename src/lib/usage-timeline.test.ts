import { describe, expect, it } from "vitest";
import { datesIn, defaultSelectedIndex, formatRange, periods, totalLabel, weekOffsetFor, weekStart } from "./usage-timeline";

const TODAY = "2026-10-28"; // a Wednesday

describe("usage timeline (Android AppUsageChartTimeline)", () => {
  it("anchors weeks on Monday", () => {
    expect(weekStart(TODAY, 0)).toBe("2026-10-26");
    expect(weekStart("2026-11-01", 0)).toBe("2026-10-26"); // Sunday
    expect(weekStart(TODAY, -1)).toBe("2026-10-19");
  });

  it("shows one calendar week of days with today selected", () => {
    const days = periods("days", weekStart(TODAY, 0));
    expect(days.map((p) => p.label).join("")).toBe("MTWTFSS");
    expect(days[0].start).toBe("2026-10-26");
    expect(defaultSelectedIndex(days, TODAY)).toBe(2);
    expect(defaultSelectedIndex(periods("days", weekStart(TODAY, -1)), TODAY)).toBe(6);
  });

  it("shows four weeks per page ending on the anchor week", () => {
    const weeks = periods("weeks", weekStart(TODAY, 0));
    expect(weeks.map((p) => p.label)).toEqual(["Oct 5", "Oct 12", "Oct 19", "Oct 26"]);
    expect(weeks[3]).toMatchObject({ start: "2026-10-26", end: "2026-11-01" });
    expect(defaultSelectedIndex(weeks, TODAY)).toBe(3);
    expect(weekOffsetFor(weeks[1], TODAY)).toBe(-2);
  });

  it("counts days only up to today", () => {
    const week = periods("weeks", weekStart(TODAY, 0))[3];
    expect(datesIn(week, TODAY)).toEqual(["2026-10-26", "2026-10-27", "2026-10-28"]);
  });

  it("labels totals like Android", () => {
    const days = periods("days", weekStart(TODAY, 0));
    const weeks = periods("weeks", weekStart(TODAY, 0));
    expect(totalLabel(days[2], "days", TODAY)).toBe("TOTAL TODAY");
    expect(totalLabel(days[0], "days", TODAY)).toBe("TOTAL · Oct 26");
    expect(totalLabel(weeks[3], "weeks", TODAY)).toBe("TOTAL THIS WEEK");
    expect(totalLabel(weeks[0], "weeks", TODAY)).toBe("TOTAL · Oct 5 to Oct 11");
    expect(formatRange("2026-12-29", "2027-01-04")).toBe("Dec 29 to Jan 4");
  });
});
