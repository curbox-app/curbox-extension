export type DateKey = string;

export interface ProceedRecord {
  count: number;
  windowStart: number;
  timestamps?: number[];
}

export interface DomainUsage {
  ms: number;
  paths: Record<string, number>;
  /** Local only. Per hour totals let scheduled limits match Android active hours. */
  hours?: Record<number, number>;
  /** Local only. Per path hour totals keep keyword limits scoped to active hours. */
  pathHours?: Record<string, Record<number, number>>;
}

export type DayUsage = Record<string, DomainUsage>;

export type UsageHistory = Record<DateKey, DayUsage>;

/** Local only. How many times each site was opened per day, for {app_opens_today}. */
export interface SiteOpens {
  last: string;
  days: Record<DateKey, Record<string, number>>;
}

// Blocking modes mirror the Android App Pause / Keyword group modes.
export type BlockingMode = "usage" | "time" | "on-open";

export interface TimeRange {
  start: number; // minutes from midnight
  end: number;
}

export interface DayConfig {
  active: boolean;
  limitMinutes: number; // zero blocks throughout active hours
  ranges: TimeRange[]; // active restriction windows
}

export interface DaySchedule {
  /** Kept for settings written by older extension versions. */
  uniform?: boolean;
  scheduleUniform: boolean;
  usageUniform: boolean;
  days: DayConfig[]; // length 7, index 0 = Sunday (JS getDay)
}

// Warning Screen mirrors the Android Unlock Challenges configuration.
export type UnlockChallenge = "never" | "effort" | "wait";
export type WaitType = "fixed" | "dynamic";
export type EffortType = "typing" | "intent" | "math";

export interface WarningScreen {
  challenge: UnlockChallenge;
  effortType: EffortType;
  sentence: string; // effort: the sentence to type
  minIntentLength: number;
  mathQuestionCount: number;
  mathStartingLevel: number;
  waitType: WaitType; // fixed: unlock duration preset here; dynamic: chosen on the warning screen
  unlockMinutes: number; // how long an unlock lasts before the warning returns
  delaySeconds: number; // brief pause before I can unlock
  customMessage: string;
  proceedLimit: number; // 0 = unlimited
  proceedWindowMinutes: number;
  focusGoalEnabled: boolean;
  focusGoalGroupId: string;
  focusGoalRequiredMinutes: number;
}

export interface BlockGroup {
  id: string;
  name: string;
  enabled: boolean;
  matchers: string[]; // plain domains or keyword patterns
  mode: BlockingMode;
  /** Android now combines active hours and usage in one group. */
  onEachOpen: boolean;
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
  // Carried for cross device sync but not enforced in the browser. A focus group
  // made on Android can also block apps and flip Do Not Disturb; the browser
  // keeps those values untouched so editing the group here does not wipe them on
  // the phone.
  packages?: string[];
  autoTurnOnDnd?: boolean;
}

export interface FocusSession {
  groupId: string;
  name: string;
  domains: string[];
  packages: string[];
  mode: FocusMode;
  startedAt: number;
  endsAt: number;
  exitable: boolean;
  plannedMs: number;
}

export interface FocusLogEntry {
  at: number;
  day: DateKey;
  startedAt?: number;
  endedAt?: number;
  groupId: string;
  name: string;
  plannedMs: number;
  actualMs: number;
  completed: boolean;
}

// Gentle Prompts mirror the Android MindfulMessageConfig: a small live note
// floating over chosen sites. Colors are #rrggbb, opacities 0 to 100 and the
// position is the prompt's center as a fraction of the viewport.
export interface GentlePromptConfig {
  enabled: boolean;
  sites: string[];
  message: string;
  textSize: number;
  textColor: string;
  textOpacity: number;
  bgColor: string;
  bgOpacity: number;
  positionX: number;
  positionY: number;
}

export interface Settings {
  schemaVersion: 2;
  groups: BlockGroup[];
  focusGroups: FocusGroup[];
  gentlePrompt: GentlePromptConfig;
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
  focusGoalRemainingMs: number;
}

export function defaultWarningScreen(): WarningScreen {
  return {
    challenge: "wait",
    effortType: "typing",
    sentence: "",
    minIntentLength: 1,
    mathQuestionCount: 3,
    mathStartingLevel: 3,
    waitType: "fixed",
    unlockMinutes: 2,
    delaySeconds: 15,
    customMessage: "",
    proceedLimit: 0,
    proceedWindowMinutes: 60,
    focusGoalEnabled: false,
    focusGoalGroupId: "",
    focusGoalRequiredMinutes: 60,
  };
}

export const PROMPT_TEXT_SIZE = { min: 8, max: 28 };

export function defaultGentlePrompt(): GentlePromptConfig {
  return {
    enabled: false,
    sites: [],
    message: "Is this really important?\nSite usage: {app_usage_today}\nScreen time: {screentime_today}\nSession: {live_session_duration}",
    textSize: 14,
    textColor: "#ffffff",
    textOpacity: 100,
    bgColor: "#000000",
    bgOpacity: 37,
    positionX: 0.5,
    positionY: 0.05,
  };
}

export function defaultSchedule(): DaySchedule {
  const days: DayConfig[] = Array.from({ length: 7 }, () => ({
    active: true,
    limitMinutes: 60,
    ranges: [{ start: 0, end: 24 * 60 }],
  }));
  return { uniform: true, scheduleUniform: true, usageUniform: true, days };
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
    onEachOpen: false,
    schedule: defaultSchedule(),
    warning: defaultWarningScreen(),
  };
}

const SETTINGS_SCHEMA_VERSION = 2;

/**
 * Upgrade settings written by older extension releases without changing the
 * restrictions users already configured. The old timed mode described allowed
 * ranges, so those ranges are inverted into Android style active block hours.
 */
export function normalizeSettings(value: unknown): Settings {
  const raw = value && typeof value === "object" ? (value as Partial<Settings> & { schemaVersion?: number }) : {};
  const focusGroups = Array.isArray(raw.focusGroups) ? raw.focusGroups.map(normalizeFocusGroup) : [];
  const sourceGroups = Array.isArray(raw.groups) ? raw.groups : [];
  const groups = sourceGroups.map((group) => normalizeGroup(group as Partial<BlockGroup>, raw.schemaVersion));
  return { schemaVersion: SETTINGS_SCHEMA_VERSION, groups, focusGroups, gentlePrompt: normalizeGentlePrompt(raw.gentlePrompt) };
}

function normalizeGentlePrompt(value: Partial<GentlePromptConfig> | undefined): GentlePromptConfig {
  const defaults = defaultGentlePrompt();
  const prompt = value ?? {};
  const color = (v: unknown, fallback: string) =>
    typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : fallback;
  const fraction = (v: unknown, fallback: number) => clamp(finiteNonNegative(v, fallback), 0, 1);
  const percent = (v: unknown, fallback: number) => clamp(finiteNonNegative(v, fallback), 0, 100);
  return {
    enabled: prompt.enabled === true,
    sites: Array.isArray(prompt.sites) ? prompt.sites.filter((v): v is string => typeof v === "string") : [],
    message: typeof prompt.message === "string" ? prompt.message : defaults.message,
    textSize: clamp(finitePositive(prompt.textSize, defaults.textSize), PROMPT_TEXT_SIZE.min, PROMPT_TEXT_SIZE.max),
    textColor: color(prompt.textColor, defaults.textColor),
    textOpacity: percent(prompt.textOpacity, defaults.textOpacity),
    bgColor: color(prompt.bgColor, defaults.bgColor),
    bgOpacity: percent(prompt.bgOpacity, defaults.bgOpacity),
    positionX: fraction(prompt.positionX, defaults.positionX),
    positionY: fraction(prompt.positionY, defaults.positionY),
  };
}

function normalizeGroup(group: Partial<BlockGroup>, schemaVersion?: number): BlockGroup {
  const legacy = schemaVersion !== SETTINGS_SCHEMA_VERSION;
  const mode: BlockingMode = group.mode === "time" || group.mode === "on-open" ? group.mode : "usage";
  const sourceSchedule = group.schedule;
  const sourceDays = Array.isArray(sourceSchedule?.days) ? sourceSchedule!.days : defaultSchedule().days;
  const days = Array.from({ length: 7 }, (_, index) => {
    const source = sourceDays[index] ?? defaultSchedule().days[index];
    let active = source.active !== false;
    let ranges = normalizeRanges(source.ranges);
    if (legacy && mode === "usage") ranges = [{ start: 0, end: 1440 }];
    if (legacy && mode === "time") {
      ranges = active ? invertRanges(ranges) : [];
      active = ranges.length > 0;
    }
    if (legacy && mode === "on-open") {
      ranges = [{ start: 0, end: 1440 }];
      active = true;
    }
    return {
      active,
      limitMinutes: finiteNonNegative(source.limitMinutes, mode === "time" || mode === "on-open" ? 0 : 60),
      ranges,
    };
  });
  const warning = normalizeWarning(group.warning);
  const onEachOpen = group.onEachOpen ?? mode === "on-open";
  return {
    id: typeof group.id === "string" && group.id ? group.id : uid(),
    name: typeof group.name === "string" ? group.name : "Untitled",
    enabled: group.enabled !== false,
    matchers: Array.isArray(group.matchers) ? group.matchers.filter((v): v is string => typeof v === "string") : [],
    mode: onEachOpen ? "on-open" : "usage",
    onEachOpen,
    schedule: {
      uniform: sourceSchedule?.uniform ?? true,
      scheduleUniform: sourceSchedule?.scheduleUniform ?? sourceSchedule?.uniform ?? true,
      usageUniform: sourceSchedule?.usageUniform ?? sourceSchedule?.uniform ?? true,
      days,
    },
    warning,
  };
}

function normalizeWarning(value: Partial<WarningScreen> | undefined): WarningScreen {
  const defaults = defaultWarningScreen();
  const warning = value ?? {};
  return {
    ...defaults,
    ...warning,
    challenge: warning.challenge === "never" || warning.challenge === "effort" ? warning.challenge : "wait",
    effortType: warning.effortType === "intent" || warning.effortType === "math" ? warning.effortType : "typing",
    minIntentLength: finitePositive(warning.minIntentLength, defaults.minIntentLength),
    mathQuestionCount: clamp(finitePositive(warning.mathQuestionCount, defaults.mathQuestionCount), 1, 10),
    mathStartingLevel: clamp(finitePositive(warning.mathStartingLevel, defaults.mathStartingLevel), 1, 10),
    unlockMinutes: finitePositive(warning.unlockMinutes, defaults.unlockMinutes),
    delaySeconds: finiteNonNegative(warning.delaySeconds, defaults.delaySeconds),
    proceedLimit: finiteNonNegative(warning.proceedLimit, defaults.proceedLimit),
    proceedWindowMinutes: finitePositive(warning.proceedWindowMinutes, defaults.proceedWindowMinutes),
    focusGoalRequiredMinutes: clamp(finitePositive(warning.focusGoalRequiredMinutes, defaults.focusGoalRequiredMinutes), 15, 1440),
  };
}

function normalizeFocusGroup(value: FocusGroup): FocusGroup {
  return {
    id: typeof value.id === "string" && value.id ? value.id : uid(),
    name: typeof value.name === "string" ? value.name : "Focus",
    domains: Array.isArray(value.domains) ? value.domains.filter((v): v is string => typeof v === "string") : [],
    mode: value.mode === "all-except" ? "all-except" : "only-these",
    exitable: value.exitable !== false,
    packages: Array.isArray(value.packages) ? value.packages.filter((v): v is string => typeof v === "string") : [],
    autoTurnOnDnd: value.autoTurnOnDnd === true,
  };
}

function normalizeRanges(value: TimeRange[] | undefined): TimeRange[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((range) => ({ start: clamp(Math.floor(Number(range.start)), 0, 1440), end: clamp(Math.floor(Number(range.end)), 0, 1440) }))
    .filter((range) => Number.isFinite(range.start) && Number.isFinite(range.end) && range.start !== range.end);
}

function invertRanges(ranges: TimeRange[]): TimeRange[] {
  const covered = new Uint8Array(1440);
  for (const range of ranges) {
    if (range.start < range.end) covered.fill(1, range.start, range.end);
    else {
      covered.fill(1, range.start, 1440);
      covered.fill(1, 0, range.end);
    }
  }
  const out: TimeRange[] = [];
  let start: number | null = null;
  for (let minute = 0; minute <= 1440; minute++) {
    const blocked = minute < 1440 && covered[minute] === 0;
    if (blocked && start === null) start = minute;
    if (!blocked && start !== null) {
      out.push({ start, end: minute });
      start = null;
    }
  }
  return out;
}

function finiteNonNegative(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function finitePositive(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function newFocusGroup(name: string): FocusGroup {
  return {
    id: uid(),
    name,
    domains: [],
    mode: "only-these",
    exitable: true,
    packages: [],
    autoTurnOnDnd: false,
  };
}
