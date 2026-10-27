import { describe, expect, it } from "vitest";
import { formatPrompt, promptValues } from "./prompt";
import { dateKey } from "./time";
import { defaultGentlePrompt, newGroup, type Settings, type UsageHistory } from "./types";

const NOW = new Date(2026, 9, 27, 15, 0).getTime();
const TODAY = dateKey(new Date(NOW));
const YESTERDAY = dateKey(new Date(2026, 9, 26, 12));
const MIN = 60_000;

function settings(): Settings {
  const social = newGroup("Social");
  social.matchers = ["instagram.com"];
  return {
    schemaVersion: 2,
    groups: [social],
    focusGroups: [],
    gentlePrompt: { ...defaultGentlePrompt(), sites: ["youtube.com", "instagram.com"] },
    grayscaleGroups: [],
  };
}

const usage: UsageHistory = {
  [TODAY]: {
    "youtube.com": { ms: 65 * MIN, paths: { "": 20 * MIN, "/shorts/abc": 30 * MIN, "/shorts/def": 15 * MIN } },
    "instagram.com": { ms: 10 * MIN, paths: { "/reel/xyz": 10 * MIN } },
    "github.com": { ms: 5 * MIN, paths: { "": 5 * MIN } },
  },
  [YESTERDAY]: {
    "youtube.com": { ms: 30 * MIN, paths: { "": 30 * MIN } },
    "instagram.com": { ms: 2 * MIN, paths: { "": 2 * MIN } },
  },
};

describe("gentle prompt variables", () => {
  const values = promptValues("youtube.com", usage, { last: "youtube.com", days: { [TODAY]: { "youtube.com": 4 } } }, settings(), NOW);

  it("fills every Android variable", () => {
    const template = [
      "{app_name}",
      "{app_usage_today}",
      "{app_usage_yesterday}",
      "{app_opens_today}",
      "{screentime_today}",
      "{screentime_yesterday}",
      "{mindful_apps_usage_today}",
      "{live_session_duration}",
      "{reel_count}",
    ].join("|");
    expect(formatPrompt(template, values, 83_000)).toBe(
      "YouTube|1 hr 5 mins|30 mins|4|1 hr 20 mins|32 mins|1 hr 15 mins|1m 23s|3",
    );
  });

  it("resolves group usage by name, ignoring case", () => {
    expect(formatPrompt("{group_usage_today:social} {group_usage_yesterday: Social }", values, 0)).toBe("10 mins 2 mins");
  });

  it("leaves unknown groups untouched and shows zero time plainly", () => {
    const empty = promptValues("example.com", {}, { last: "", days: {} }, settings(), NOW);
    expect(formatPrompt("{group_usage_today:Work} {app_usage_today} {live_session_duration}", empty, 4_000)).toBe(
      "{group_usage_today:Work} 0 mins 4s",
    );
  });
});
