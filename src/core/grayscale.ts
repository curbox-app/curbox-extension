import { activeWindow } from "./blocker";
import { groupMatches } from "../lib/match";
import type { SiteLocation } from "../lib/url";
import type { Settings } from "../lib/types";

export function shouldGrayscale(location: SiteLocation, settings: Settings, now = Date.now()): boolean {
  return settings.grayscaleGroups.some(
    (group) => group.enabled && groupMatches(location, group.sites) && activeWindow(group.schedule, now) !== null,
  );
}
