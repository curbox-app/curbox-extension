export type DateKey = string;

export interface DomainUsage {
  ms: number;
  paths: Record<string, number>;
}

export type DayUsage = Record<string, DomainUsage>;

export type UsageHistory = Record<DateKey, DayUsage>;

// Blocking modes mirror the Android App Pause / Keyword group modes.
export type BlockingMode = "usage" | "time" | "on-open";

export interface TimeRange {
  start: number; // minutes from midnight
  end: number;
}

export interface DayConfig {
  active: boolean;
  limitMinutes: number; // usage mode: daily limit for this day
  ranges: TimeRange[]; // time mode: windows the site is allowed
}

export interface DaySchedule {
  uniform: boolean; // same setting every day
  days: DayConfig[]; // length 7, index 0 = Sunday (JS getDay)
}

// Warning Screen mirrors the Android Unlock Challenges configuration.
export type UnlockChallenge = "never" | "effort" | "wait";
export type WaitType = "fixed" | "dynamic";

export interface WarningScreen {
  challenge: UnlockChallenge;
  sentence: string; // effort: the sentence to type
  waitType: WaitType; // fixed: unlock duration preset here; dynamic: chosen on the warning screen
  unlockMinutes: number; // how long an unlock lasts before the warning returns
  delaySeconds: number; // brief pause before I can unlock
  customMessage: string;
  proceedLimit: number; // 0 = unlimited
  proceedWindowMinutes: number;
}

export interface BlockGroup {
  id: string;
  name: string;
  enabled: boolean;
  matchers: string[]; // plain domains or keyword patterns
  mode: BlockingMode;
  schedule: DaySchedule;
  warning: WarningScreen;
}

// Focus Mode mirrors the Android Focus tab.
export type FocusMode = "only-these" | "all-except";

export interface FocusGroup {
  id: string;
  name: string;
  domains: string[];
  mode: FocusMode;
  exitable: boolean; // "Let me quit mid sessions"
}

export interface FocusSession {
  groupId: string;
  name: string;
  domains: string[];
  mode: FocusMode;
  startedAt: number;
  endsAt: number;
  exitable: boolean;
  plannedMs: number;
}

export interface FocusLogEntry {
  at: number;
  day: DateKey;
  groupId: string;
  name: string;
  plannedMs: number;
  actualMs: number;
  completed: boolean;
}

export interface Settings {
  groups: BlockGroup[];
  focusGroups: FocusGroup[];
}

export type BlockSource = "group" | "focus";
export type BlockReason = "time" | "usage" | "on-open" | "focus" | "";

export interface BlockDecision {
  blocked: boolean;
  source: BlockSource;
  groupId: string;
  groupName: string;
  reason: BlockReason;
  message: string;
  warning: WarningScreen | null;
  canProceed: boolean;
  focusExitable: boolean;
}

export function defaultWarningScreen(): WarningScreen {
  return {
    challenge: "wait",
    sentence: "",
    waitType: "fixed",
    unlockMinutes: 15,
    delaySeconds: 5,
    customMessage: "",
    proceedLimit: 0,
    proceedWindowMinutes: 60,
  };
}

export function defaultSchedule(): DaySchedule {
  const days: DayConfig[] = Array.from({ length: 7 }, () => ({
    active: true,
    limitMinutes: 0,
    ranges: [{ start: 9 * 60, end: 17 * 60 }],
  }));
  return { uniform: true, days };
}

export function uid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function newGroup(name: string): BlockGroup {
  return {
    id: uid(),
    name,
    enabled: true,
    matchers: [],
    mode: "usage",
    schedule: defaultSchedule(),
    warning: defaultWarningScreen(),
  };
}

export function newFocusGroup(name: string): FocusGroup {
  return {
    id: uid(),
    name,
    domains: [],
    mode: "only-these",
    exitable: true,
  };
}
