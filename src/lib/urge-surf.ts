import type { CravingSession } from "./types";

export const plural = (n: number, one: string, other: string) => (n === 1 ? one : other).replace("%d", String(n));

export function usualDrop(sessions: CravingSession[]): number {
  // A single result is not a pattern yet.
  if (sessions.length < 3) return 0;
  return Math.round(sessions.reduce((sum, s) => sum + s.ratingBefore - s.ratingAfter, 0) / sessions.length);
}
