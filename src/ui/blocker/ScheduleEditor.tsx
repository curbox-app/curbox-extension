import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { DaySchedule, TimeRange } from "../../lib/types";
import { clockToMinutes, minutesToClock } from "../../lib/time";
import { DayChips, inputCls } from "../components";
import { DAY_NAMES } from "./constants";

type ScheduleMode = "all-day" | "daily" | "custom";
type LimitMode = "daily" | "custom";

export function ScheduleEditor({
  schedule,
  onChange,
  showLimit = true,
}: {
  schedule: DaySchedule;
  onChange: (schedule: DaySchedule) => void;
  showLimit?: boolean;
}) {
  const [sheet, setSheet] = useState<"hours" | "limit" | null>(null);
  const mode = scheduleMode(schedule);
  const limitMode: LimitMode = schedule.usageUniform ? "daily" : "custom";
  const first = schedule.days.find((day) => day.active) ?? schedule.days[0];
  const active = schedule.days.map((day) => day.active);

  const setMode = (next: ScheduleMode) => {
    if (next === "all-day") {
      onChange({ ...schedule, scheduleUniform: true, days: schedule.days.map((day) => ({ ...day, active: true, ranges: [{ start: 0, end: 1440 }] })) });
      return;
    }
    if (next === "daily") {
      const ranges = isAllDay(first.ranges) ? [{ start: 9 * 60, end: 17 * 60 }] : first.ranges;
      onChange({ ...schedule, scheduleUniform: true, days: schedule.days.map((day) => ({ ...day, active: true, ranges })) });
      return;
    }
    onChange({ ...schedule, scheduleUniform: false });
  };

  const setAllRanges = (ranges: TimeRange[]) =>
    onChange({ ...schedule, days: schedule.days.map((day) => ({ ...day, active: true, ranges })) });
  const setDayRanges = (index: number, ranges: TimeRange[]) =>
    onChange({ ...schedule, days: schedule.days.map((day, i) => (i === index ? { ...day, ranges } : day)) });
  const setAllLimits = (limitMinutes: number) =>
    onChange({ ...schedule, days: schedule.days.map((day) => ({ ...day, limitMinutes })) });
  const setDayLimit = (index: number, limitMinutes: number) =>
    onChange({ ...schedule, days: schedule.days.map((day, i) => (i === index ? { ...day, limitMinutes } : day)) });

  return (
    <div className="flex flex-col gap-5">
      <button type="button" onClick={() => setSheet("hours")} className="card flex items-center gap-4 p-5 text-left">
        <span className="min-w-0 flex-1">
          <b className="block text-base text-ink">Active hours</b>
          <small className="block truncate text-muted">{hoursSummary(schedule)}</small>
        </span>
        <span className="text-faint">›</span>
      </button>
      {sheet === "hours" && (
        <ActiveHoursSheet
          mode={mode}
          schedule={schedule}
          active={active}
          ranges={first.ranges}
          onMode={setMode}
          onAllRanges={setAllRanges}
          onDayRanges={setDayRanges}
          onToggleDay={(index) =>
            onChange({
              ...schedule,
              days: schedule.days.map((day, i) => (i === index ? { ...day, active: !day.active } : day)),
            })
          }
          onClose={() => setSheet(null)}
        />
      )}

      {showLimit && (
        <button type="button" onClick={() => setSheet("limit")} className="card flex items-center gap-4 p-5 text-left">
          <span className="min-w-0 flex-1">
            <b className="block text-base text-ink">Usage limit</b>
            <small className="block truncate text-muted">{limitSummary(schedule)}</small>
          </span>
          <span className="text-faint">›</span>
        </button>
      )}
      {sheet === "limit" && (
        <UsageLimitSheet
          mode={limitMode}
          schedule={schedule}
          shared={first.limitMinutes}
          onMode={(next) => {
            if (next === "daily") {
              onChange({
                ...schedule,
                usageUniform: true,
                days: schedule.days.map((day) => ({ ...day, limitMinutes: first.limitMinutes })),
              });
              return;
            }
            onChange({ ...schedule, usageUniform: false });
          }}
          onShared={setAllLimits}
          onDay={setDayLimit}
          onClose={() => setSheet(null)}
        />
      )}
    </div>
  );
}

const MODES: { value: ScheduleMode; label: string }[] = [
  { value: "all-day", label: "All day" },
  { value: "daily", label: "Daily" },
  { value: "custom", label: "Custom" },
];

function ActiveHoursSheet({
  mode,
  schedule,
  active,
  ranges,
  onMode,
  onAllRanges,
  onDayRanges,
  onToggleDay,
  onClose,
}: {
  mode: ScheduleMode;
  schedule: DaySchedule;
  active: boolean[];
  ranges: TimeRange[];
  onMode: (mode: ScheduleMode) => void;
  onAllRanges: (ranges: TimeRange[]) => void;
  onDayRanges: (index: number, ranges: TimeRange[]) => void;
  onToggleDay: (index: number) => void;
  onClose: () => void;
}) {
  return (
    <EditorSheet title="Active hours" subtitle={modeCopy(mode)} onClose={onClose} nav={<ModeNav value={mode} options={MODES} onChange={onMode} />}>
      {mode === "all-day" && <p className="text-sm text-muted">These sites stay in the way from morning to night.</p>}
      {mode === "daily" && <RangeEditor ranges={ranges} onChange={onAllRanges} />}
      {mode === "custom" && (
        <div className="flex flex-col gap-4">
          <DayChips active={active} onToggle={onToggleDay} />
          <div className="flex flex-col gap-3">
            {schedule.days.map((day, index) =>
              day.active ? (
                <div key={index} className="flex flex-col gap-1">
                  <span className="text-xs text-muted">{DAY_NAMES[index]}</span>
                  <RangeEditor ranges={day.ranges} onChange={(next) => onDayRanges(index, next)} />
                </div>
              ) : null,
            )}
          </div>
        </div>
      )}
    </EditorSheet>
  );
}

const LIMIT_MODES: { value: LimitMode; label: string }[] = [
  { value: "daily", label: "Daily" },
  { value: "custom", label: "Custom" },
];

function UsageLimitSheet({
  mode,
  schedule,
  shared,
  onMode,
  onShared,
  onDay,
  onClose,
}: {
  mode: LimitMode;
  schedule: DaySchedule;
  shared: number;
  onMode: (mode: LimitMode) => void;
  onShared: (minutes: number) => void;
  onDay: (index: number, minutes: number) => void;
  onClose: () => void;
}) {
  const activeDays = schedule.days.flatMap((day, index) => (day.active ? [index] : []));
  return (
    <EditorSheet
      title="Usage limit"
      subtitle={mode === "daily" ? "I use the same limit every day." : "Set a limit for each day."}
      onClose={onClose}
      nav={<ModeNav value={mode} options={LIMIT_MODES} onChange={onMode} />}
    >
      <p className="mb-4 text-sm text-muted">0 minutes blocks the whole active window.</p>
      {mode === "daily" && <LimitInput value={shared} onChange={onShared} />}
      {mode === "custom" && (
        activeDays.length === 0 ? (
          <p className="text-sm text-muted">Turn on a day in active hours first.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {activeDays.map((index) => (
              <label key={index} className="flex items-center gap-3 text-sm">
                <span className="w-8 text-muted">{DAY_NAMES[index]}</span>
                <LimitInput value={schedule.days[index]!.limitMinutes} onChange={(minutes) => onDay(index, minutes)} />
              </label>
            ))}
          </div>
        )
      )}
    </EditorSheet>
  );
}

export function EditorSheet({
  title,
  subtitle,
  nav,
  onClose,
  children,
}: {
  title: string;
  subtitle: string;
  nav?: ReactNode;
  onClose: () => void;
  children: ReactNode;
}) {
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center">
      <button type="button" aria-label={`Close ${title}`} className="absolute inset-0 bg-ink/30" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative flex max-h-[85vh] w-full max-w-xl flex-col overflow-hidden rounded-t-[24px] bg-bg shadow-float"
      >
        <div className="flex items-center justify-between px-6 pb-2 pt-5">
          <div>
            <p className="font-display text-3xl leading-none">{title}</p>
            <p className="mt-2 text-sm text-muted">{subtitle}</p>
          </div>
          <button type="button" onClick={onClose} className="text-sm font-medium text-primary">
            Close
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 py-4">{children}</div>
        {nav}
      </div>
    </div>,
    document.body,
  );
}

function ModeNav<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <nav className="flex border-t border-line bg-card pb-2 pt-2">
      {options.map((item) => {
        const selected = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            className="flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium"
          >
            <span className={`rounded-full px-4 py-1.5 ${selected ? "bg-secondary-chip text-on-secondary" : "text-faint"}`}>
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

function limitSummary(schedule: DaySchedule): string {
  if (schedule.usageUniform) {
    const day = schedule.days.find((item) => item.active) ?? schedule.days[0];
    return minutesLabel(day.limitMinutes);
  }
  const parts = schedule.days.flatMap((day, index) => (day.active ? [`${DAY_NAMES[index]} ${minutesLabel(day.limitMinutes)}`] : []));
  return parts.length ? parts.join(", ") : "No days selected";
}

function minutesLabel(minutes: number): string {
  if (minutes === 0) return "Blocked";
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

export function hoursSummary(schedule: DaySchedule): string {
  const mode = scheduleMode(schedule);
  if (mode === "all-day") return "All day";
  if (mode === "daily") {
    const day = schedule.days.find((item) => item.active) ?? schedule.days[0];
    return rangesLabel(day.ranges);
  }
  const names = schedule.days.flatMap((day, index) => (day.active ? [DAY_NAMES[index]] : []));
  return names.length ? names.join(", ") : "No days selected";
}

function rangesLabel(ranges: TimeRange[]): string {
  if (ranges.length === 0) return "No hours set";
  return ranges.map((range) => `${minutesToClock(range.start % 1440)} to ${range.end >= 1440 ? "24:00" : minutesToClock(range.end % 1440)}`).join(" and ");
}

function modeCopy(mode: ScheduleMode): string {
  if (mode === "all-day") return "I watch these sites all day.";
  if (mode === "daily") return "I use the same hours every day.";
  return "Pick each day, then set its hours.";
}

function LimitInput({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  return (
    <span className="flex items-center gap-2 text-sm">
      <input
        type="number"
        min={0}
        value={value}
        onChange={(event) => onChange(Math.max(0, Math.floor(Number(event.target.value)) || 0))}
        className={`${inputCls} w-20`}
      />
      minutes
    </span>
  );
}

function RangeEditor({ ranges, onChange }: { ranges: TimeRange[]; onChange: (ranges: TimeRange[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {ranges.map((range, index) => (
        <div key={index} className="flex items-center gap-2 text-sm">
          <input
            type="time"
            value={minutesToClock(range.start % 1440)}
            onChange={(event) =>
              onChange(ranges.map((item, i) => (i === index ? { ...item, start: clockToMinutes(event.target.value) } : item)))
            }
            className={inputCls}
          />
          to
          <input
            type="time"
            value={minutesToClock(range.end % 1440)}
            onChange={(event) => {
              const end = clockToMinutes(event.target.value);
              onChange(ranges.map((item, i) => (i === index ? { ...item, end: end === 0 && item.start === 0 ? 1440 : end } : item)));
            }}
            className={inputCls}
          />
          <button onClick={() => onChange(ranges.filter((_, i) => i !== index))} className="text-xs text-muted">✕</button>
        </div>
      ))}
      <button onClick={() => onChange([...ranges, { start: 9 * 60, end: 17 * 60 }])} className="self-start text-xs text-muted">
        + Add time range
      </button>
    </div>
  );
}

function scheduleMode(schedule: DaySchedule): ScheduleMode {
  if (schedule.days.every((day) => day.active && isAllDay(day.ranges))) return "all-day";
  return schedule.scheduleUniform ? "daily" : "custom";
}

function isAllDay(ranges: TimeRange[]): boolean {
  return ranges.length === 1 && ranges[0].start === 0 && ranges[0].end === 1440;
}
