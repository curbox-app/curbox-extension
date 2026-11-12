import { get, update } from "../lib/storage";
import { groupMatches } from "../lib/match";
import type { SiteLocation } from "../lib/url";
import type { SipStretchConfig, SipStretchState } from "../lib/types";

export const IDLE_SIP_STRETCH: SipStretchState = { usedMs: 0, lastAt: 0, breakEndsAt: 0 };

// Mirrors Android SipStretch: time on the chosen sites adds up until the limit,
// then a break starts. Time away counts as rest, and a rest as long as one
// break starts the count over.
export function countSpan(state: SipStretchState, config: SipStretchConfig, from: number, to: number): SipStretchState {
  if (state.breakEndsAt > from) return state;
  const breakMs = config.breakMinutes * 60_000;
  const rested = state.lastAt > 0 && from - state.lastAt >= breakMs;
  const usedMs = (rested || state.breakEndsAt > 0 ? 0 : state.usedMs) + Math.max(0, to - from);
  if (usedMs >= config.usageLimitMinutes * 60_000) return { usedMs: 0, lastAt: 0, breakEndsAt: to + breakMs };
  return { usedMs, lastAt: to, breakEndsAt: 0 };
}

export async function noteSpan(location: SiteLocation, from: number, to: number): Promise<void> {
  const { sipStretch } = await get("settings");
  if (!sipStretch.enabled || !groupMatches(location, sipStretch.sites)) return;
  await update("sipStretch", (state) => countSpan(state, sipStretch, from, to));
}

export function endBreakIfDue(now = Date.now()): Promise<SipStretchState> {
  return update("sipStretch", (state) => (state.breakEndsAt > 0 && state.breakEndsAt <= now ? IDLE_SIP_STRETCH : state));
}

export function resetSipStretch(): Promise<SipStretchState> {
  return update("sipStretch", (state) =>
    state.usedMs === 0 && state.lastAt === 0 && state.breakEndsAt === 0 ? state : IDLE_SIP_STRETCH,
  );
}
