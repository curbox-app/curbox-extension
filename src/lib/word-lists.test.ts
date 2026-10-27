import { describe, expect, it } from "vitest";
import { compileList, packFromPath, parseWordList, targetMatches } from "./word-lists";

describe("word lists", () => {
  it("reads plain lists like Android and skips duplicates and blanks", () => {
    expect(parseWordList("youtube.com\n\n  reddit.com  \nyoutube.com\n/shorts\n", ["reddit.com"])).toEqual([
      "youtube.com",
      "/shorts",
    ]);
  });

  it("reads hosts files", () => {
    const hosts = "# Title\n127.0.0.1 localhost\n0.0.0.0 0.0.0.0\n0.0.0.0 facebook.com # social\n0.0.0.0 tiktok.com\n";
    expect(parseWordList(hosts)).toEqual(["facebook.com", "tiktok.com"]);
  });

  it("matches listed domains, their subdomains and keyword entries", () => {
    const lists = new Map([["l", compileList("facebook.com\nr:shorts")]]);
    const group = { matchers: [], lists: [{ id: "l", name: "Social", count: 2 }] };
    expect(targetMatches({ domain: "m.facebook.com", path: "/" }, group, lists)).toBe(true);
    expect(targetMatches({ domain: "notfacebook.com", path: "/" }, group, lists)).toBe(false);
    expect(targetMatches({ domain: "youtube.com", path: "/shorts/x" }, group, lists)).toBe(true);
    expect(targetMatches({ domain: "facebook.com", path: "/" }, group, new Map())).toBe(false);
  });

  it("names packs from the repository layout", () => {
    expect(packFromPath("websites/alternates/social-only/websites.txt", 1)).toMatchObject({ name: "Social", section: "Topics" });
    expect(packFromPath("websites/alternates/porn-social-only/websites.txt", 1)).toMatchObject({ name: "Porn + social", section: "Mixed topics" });
    expect(packFromPath("websites/extensions/fakenews/websites.txt", 1)).toBeNull();
    expect(packFromPath("websites/alternates/gambling-social/websites.txt", 1)?.name).toBe("Gambling + social + ads");
    expect(packFromPath("websites/extensions/porn/bigdargon/websites.txt", 1)).toMatchObject({ name: "Porn · bigdargon", section: "Topics" });
    expect(packFromPath("websites/data/adaway.org/websites.txt", 1)?.name).toBe("adaway.org");
    expect(packFromPath("websites/websites.txt", 1)?.name).toBe("All ads and trackers");
    expect(packFromPath("alternates/social/hosts", 1)).toBeNull();
  });
});
