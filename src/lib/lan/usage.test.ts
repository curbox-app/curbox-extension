import { describe, expect, it } from "vitest";
import { changedDays, clientName, usageDays } from "./usage";

describe("lan usage", () => {
  const history = {
    "2026-11-02": { "a.com": { ms: 120_000, paths: {} }, "b.com": { ms: 600_000, paths: {} }, "skip.com": { ms: 9e6, paths: {} } },
    "2026-11-03": { "a.com": { ms: 0, paths: {} } },
  };

  it("sums sites per day without ignored ones", () => {
    const days = usageDays(history, ["2026-11-02", "2026-11-03"], ["skip.com"]);
    expect(days).toEqual([
      { date: "2026-11-02", totalMs: 720_000, sites: [{ domain: "b.com", ms: 600_000 }, { domain: "a.com", ms: 120_000 }] },
    ]);
  });

  it("resends missing days and totals that moved by a minute", () => {
    const local = usageDays(history, ["2026-11-02"], []);
    expect(changedDays(local, null)).toHaveLength(1);
    expect(changedDays(local, { "2026-11-02": local[0].totalMs - 30_000 })).toHaveLength(0);
    expect(changedDays(local, { "2026-11-02": local[0].totalMs - 90_000 })).toHaveLength(1);
  });

  it("names the browser", () => {
    expect(clientName("Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:140.0) Gecko/20100101 Firefox/140.0")).toBe("Firefox on Mac");
    expect(clientName("Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/140.0 Safari/537.36")).toBe("Chrome on Windows");
  });
});
