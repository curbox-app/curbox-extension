import type { BlockingMode, DaySchedule, TimeRange } from "../../lib/types";
import { clockToMinutes, minutesToClock } from "../../lib/time";
import { Toggle, DayChips, inputCls } from "../components";
import { DAY_NAMES } from "./constants";

export function ScheduleEditor({
  mode,
  schedule,
  onChange,
}: {
  mode: BlockingMode;
  schedule: DaySchedule;
  onChange: (schedule: DaySchedule) => void;
}) {
  const active = schedule.days.map((d) => d.active);
  const firstActive = schedule.days.find((d) => d.active) ?? schedule.days[0];

  const toggleDay = (i: number) =>
    onChange({ ...schedule, days: schedule.days.map((d, j) => (j === i ? { ...d, active: !d.active } : d)) });

  const setAllLimits = (minutes: number) =>
    onChange({ ...schedule, days: schedule.days.map((d) => ({ ...d, limitMinutes: minutes })) });

  const setDayLimit = (i: number, minutes: number) =>
    onChange({ ...schedule, days: schedule.days.map((d, j) => (j === i ? { ...d, limitMinutes: minutes } : d)) });

  const setAllRanges = (ranges: TimeRange[]) =>
    onChange({ ...schedule, days: schedule.days.map((d) => ({ ...d, ranges })) });

  const setDayRanges = (i: number, ranges: TimeRange[]) =>
    onChange({ ...schedule, days: schedule.days.map((d, j) => (j === i ? { ...d, ranges } : d)) });

  return (
    <div className="flex flex-col gap-3">
      <p className="label">{mode === "usage" ? "Allowed each day" : "Allowed schedule"}</p>
      <DayChips active={active} onToggle={toggleDay} />

      {mode === "usage" ? (
        <>
          <label className="flex items-center justify-between text-xs text-muted">
            Different limit each day
            <Toggle on={!schedule.uniform} onChange={(v) => onChange({ ...schedule, uniform: !v })} />
          </label>
          {schedule.uniform ? (
            <label className="text-sm flex items-center gap-2">
              Daily limit
              <input
                type="number"
                min={0}
                value={firstActive.limitMinutes}
                onChange={(e) => setAllLimits(Math.max(0, Number(e.target.value)))}
                className={`${inputCls} w-16`}
              />
              minutes
            </label>
          ) : (
            <div className="flex flex-col gap-1">
              {schedule.days.map((d, i) =>
                d.active ? (
                  <label key={i} className="text-sm flex items-center gap-2">
                    <span className="w-8 text-muted">{DAY_NAMES[i]}</span>
                    <input
                      type="number"
                      min={0}
                      value={d.limitMinutes}
                      onChange={(e) => setDayLimit(i, Math.max(0, Number(e.target.value)))}
                      className={`${inputCls} w-16`}
                    />
                    minutes
                  </label>
                ) : null,
              )}
            </div>
          )}
        </>
      ) : (
        <>
          <label className="flex items-center justify-between text-xs text-muted">
            Different schedule each day
            <Toggle on={!schedule.uniform} onChange={(v) => onChange({ ...schedule, uniform: !v })} />
          </label>
          {schedule.uniform ? (
            <RangeEditor ranges={firstActive.ranges} onChange={setAllRanges} />
          ) : (
            <div className="flex flex-col gap-3">
              {schedule.days.map((d, i) =>
                d.active ? (
                  <div key={i} className="flex flex-col gap-1">
                    <span className="text-xs text-muted">{DAY_NAMES[i]}</span>
                    <RangeEditor ranges={d.ranges} onChange={(ranges) => setDayRanges(i, ranges)} />
                  </div>
                ) : null,
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function RangeEditor({ ranges, onChange }: { ranges: TimeRange[]; onChange: (ranges: TimeRange[]) => void }) {
  return (
    <div className="flex flex-col gap-2">
      {ranges.map((r, i) => (
        <div key={i} className="flex items-center gap-2 text-sm">
          <input
            type="time"
            value={minutesToClock(r.start)}
            onChange={(e) =>
              onChange(ranges.map((x, j) => (j === i ? { ...x, start: clockToMinutes(e.target.value) } : x)))
            }
            className={inputCls}
          />
          to
          <input
            type="time"
            value={minutesToClock(r.end)}
            onChange={(e) => onChange(ranges.map((x, j) => (j === i ? { ...x, end: clockToMinutes(e.target.value) } : x)))}
            className={inputCls}
          />
          <button onClick={() => onChange(ranges.filter((_, j) => j !== i))} className="text-xs text-muted">
            ✕
          </button>
        </div>
      ))}
      <button
        onClick={() => onChange([...ranges, { start: 9 * 60, end: 17 * 60 }])}
        className="self-start text-xs text-muted"
      >
        + Add time range
      </button>
    </div>
  );
}
