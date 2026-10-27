import { describe, expect, it } from "vitest";
import { buildUsageCsv, csvFileName } from "./usage-csv";
import type { UsageHistory } from "./types";

const MIN = 60_000;
const usage: UsageHistory = {
  "2026-10-01": { "youtube.com": { ms: 30 * MIN, paths: { "": 30 * MIN } } },
  "2026-10-02": {
    "youtube.com": { ms: 10 * MIN, paths: { "": 10 * MIN } },
    "github.com": { ms: 90_500, paths: { "": 90_500 } },
  },
};
const HEADER = "Date,Website,Domain,Category,Duration (ms),Duration (mins)";

describe("usage CSV export (Android generateAndExportCsv)", () => {
  it("writes a daily breakdown", () => {
    expect(buildUsageCsv(usage, "2026-10-01", "2026-10-03", "daily")).toBe(
      [
        "--- DAILY BREAKDOWN ---",
        HEADER,
        "2026-10-01,YouTube,youtube.com,Video,1800000,30",
        "2026-10-02,YouTube,youtube.com,Video,600000,10",
        "2026-10-02,GitHub,github.com,Productivity,90500,1",
        "",
        "",
      ].join("\n"),
    );
  });

  it("writes a total summary across the range", () => {
    expect(buildUsageCsv(usage, "2026-10-01", "2026-10-02", "total")).toBe(
      [
        "--- TOTAL SUMMARY (2026-10-01 to 2026-10-02) ---",
        HEADER,
        "TOTAL RANGE,YouTube,youtube.com,Video,2400000,40",
        "TOTAL RANGE,GitHub,github.com,Productivity,90500,1",
        "",
      ].join("\n"),
    );
  });

  it("writes both sections and names the file by its start date", () => {
    const csv = buildUsageCsv(usage, "2026-10-01", "2026-10-02", "both");
    expect(csv.indexOf("--- DAILY BREAKDOWN ---")).toBe(0);
    expect(csv).toContain("\n\n--- TOTAL SUMMARY");
    expect(csvFileName("2026-10-01")).toBe("UsageData_2026-10-01.csv");
  });
});
