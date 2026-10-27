import { describe, expect, it } from "vitest";
import { HIDER_RULES, rulesForSite } from "./ui-hider";

describe("ui hider rules", () => {
  it("applies YouTube rules on desktop and mobile hosts only", () => {
    expect(rulesForSite("youtube.com")).toHaveLength(HIDER_RULES.length);
    expect(rulesForSite("m.youtube.com")).toHaveLength(HIDER_RULES.length);
    expect(rulesForSite("notyoutube.com")).toHaveLength(0);
    expect(rulesForSite("github.com")).toHaveLength(0);
  });

  it("has unique ids and real CSS for every rule", () => {
    expect(new Set(HIDER_RULES.map((r) => r.id)).size).toBe(HIDER_RULES.length);
    for (const rule of HIDER_RULES) expect(rule.css).toMatch(/\{[^}]*\}/);
  });
});
