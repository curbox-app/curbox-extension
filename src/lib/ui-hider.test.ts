import { describe, expect, it } from "vitest";
import { HIDER_RULES, rulesForSite } from "./ui-hider";

describe("ui hider rules", () => {
  it("applies YouTube rules on YouTube hosts only", () => {
    const youtube = HIDER_RULES.filter((r) => r.site === "YouTube").length;
    expect(rulesForSite("youtube.com")).toHaveLength(youtube);
    expect(rulesForSite("m.youtube.com")).toHaveLength(youtube);
    expect(rulesForSite("notyoutube.com")).toHaveLength(0);
    expect(rulesForSite("github.com")).toHaveLength(0);
  });

  it("applies X rules on x.com and twitter.com", () => {
    expect(rulesForSite("x.com").map((r) => r.id)).toEqual(["x-for-you"]);
    expect(rulesForSite("mobile.twitter.com").map((r) => r.id)).toEqual(["x-for-you"]);
  });

  it("has unique ids and real CSS for every rule", () => {
    expect(new Set(HIDER_RULES.map((r) => r.id)).size).toBe(HIDER_RULES.length);
    for (const rule of HIDER_RULES) expect(rule.css).toMatch(/\{[^}]*\}/);
  });
});
