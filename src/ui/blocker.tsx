import { useState } from "react";
import type { BlockGroup, BlockingMode, DaySchedule, TimeRange, WarningScreen } from "../lib/types";
import { newGroup } from "../lib/types";
import { clockToMinutes, minutesToClock } from "../lib/time";
import { Segmented, Toggle, DayChips } from "./components";

const MODE_OPTIONS: { value: BlockingMode; label: string }[] = [
  { value: "usage", label: "Usage Based" },
  { value: "time", label: "Time Based" },
  { value: "on-open", label: "On each open" },
];

const MODE_LABEL: Record<BlockingMode, string> = {
  usage: "Usage Based",
  time: "Time Based",
  "on-open": "On each open",
};

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const inputCls = "bg-transparent border-b border-line py-1 px-1 text-sm focus:outline-none focus:border-ink";

export function GroupManager({ groups, onChange }: { groups: BlockGroup[]; onChange: (groups: BlockGroup[]) => void }) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = groups.find((g) => g.id === editingId);

  if (editing) {
    return (
      <GroupEditor
        group={editing}
        onSave={(next) => {
          onChange(groups.map((g) => (g.id === next.id ? next : g)));
          setEditingId(null);
        }}
        onCancel={() => setEditingId(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.length === 0 && <p className="text-sm text-muted py-2">No blocks yet. Add one below.</p>}
      {groups.map((group) => (
        <div key={group.id} className="flex items-center justify-between border-b border-line py-3">
          <button className="text-left" onClick={() => setEditingId(group.id)}>
            <p className="text-sm">{group.name}</p>
            <p className="text-xs text-muted">
              {group.matchers.length} site{group.matchers.length === 1 ? "" : "s"} · {MODE_LABEL[group.mode]}
            </p>
          </button>
          <div className="flex items-center gap-3">
            <Toggle
              on={group.enabled}
              onChange={(on) => onChange(groups.map((g) => (g.id === group.id ? { ...g, enabled: on } : g)))}
            />
            <button
              onClick={() => onChange(groups.filter((g) => g.id !== group.id))}
              className="text-xs text-muted hover:text-ink"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button
        onClick={() => {
          const group = newGroup(`New group ${groups.length + 1}`);
          onChange([...groups, group]);
          setEditingId(group.id);
        }}
        className="mt-2 self-start rounded-full border border-ink px-5 py-2 text-sm"
      >
        New group
      </button>
    </div>
  );
}

function GroupEditor({
  group,
  onSave,
  onCancel,
}: {
  group: BlockGroup;
  onSave: (group: BlockGroup) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<BlockGroup>(group);
  const [entry, setEntry] = useState("");

  const patch = (p: Partial<BlockGroup>) => setDraft((d) => ({ ...d, ...p }));

  const addMatcher = () => {
    const clean = entry.trim().toLowerCase();
    if (!clean || draft.matchers.includes(clean)) return setEntry("");
    patch({ matchers: [...draft.matchers, clean] });
    setEntry("");
  };

  return (
    <div className="flex flex-col gap-5">
      <input
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="Group name"
        className={`${inputCls} text-base`}
      />

      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-muted">Websites and keywords to block</p>
        <div className="flex gap-2">
          <input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addMatcher()}
            placeholder="youtube.com or youtube.com/shorts"
            className={`${inputCls} flex-1`}
          />
          <button onClick={addMatcher} className="rounded-full border border-ink px-4 text-sm">
            Add
          </button>
        </div>
        <div className="flex flex-col">
          {draft.matchers.map((m) => (
            <div key={m} className="flex items-center justify-between border-b border-line py-2">
              <span className="text-sm font-mono">{m}</span>
              <button
                onClick={() => patch({ matchers: draft.matchers.filter((x) => x !== m) })}
                className="text-xs text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-muted">Blocking</p>
        <Segmented value={draft.mode} options={MODE_OPTIONS} onChange={(mode) => patch({ mode })} />
      </div>

      {draft.mode !== "on-open" && (
        <ScheduleEditor mode={draft.mode} schedule={draft.schedule} onChange={(schedule) => patch({ schedule })} />
      )}

      <WarningEditor warning={draft.warning} onChange={(warning) => patch({ warning })} />

      <div className="flex gap-3">
        <button
          onClick={() => onSave({ ...draft, name: draft.name.trim() || "Untitled" })}
          className="rounded-full border border-ink px-6 py-2 text-sm"
        >
          Done
        </button>
        <button onClick={onCancel} className="text-sm text-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}

function ScheduleEditor({
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

  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs uppercase tracking-widest text-muted">
        {mode === "usage" ? "Allowed each day" : "Allowed schedule"}
      </p>
      <DayChips active={active} onToggle={toggleDay} />

      {mode === "usage" ? (
        <>
          <label className="flex items-center justify-between text-xs text-muted">
            Different limit each day
            <Toggle on={!schedule.uniform} onChange={(v) => onChange({ ...schedule, uniform: !v })} />
          </label>
          {schedule.uniform ? (
            <label className="text-sm flex items-center gap-2">
              Block after
              <input
                type="number"
                min={1}
                value={firstActive.limitMinutes}
                onChange={(e) => setAllLimits(Math.max(1, Number(e.target.value)))}
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
                      min={1}
                      value={d.limitMinutes}
                      onChange={(e) => setDayLimit(i, Math.max(1, Number(e.target.value)))}
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
        <RangeEditor ranges={firstActive.ranges} onChange={setAllRanges} />
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

function WarningEditor({ warning, onChange }: { warning: WarningScreen; onChange: (w: WarningScreen) => void }) {
  const [open, setOpen] = useState(false);
  const patch = (p: Partial<WarningScreen>) => onChange({ ...warning, ...p });

  return (
    <div className="flex flex-col gap-3 border border-line rounded-2xl p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between text-left">
        <span className="text-sm">Warning screen</span>
        <span className="text-xs text-muted">{open ? "Hide" : "Configure"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">When I try to get past this</p>
            <Segmented
              value={warning.challenge}
              options={[
                { value: "never", label: "Never unlock" },
                { value: "effort", label: "Require effort" },
                { value: "wait", label: "Wait to unlock" },
              ]}
              onChange={(challenge) => patch({ challenge })}
            />
          </div>

          {warning.challenge === "effort" && (
            <input
              value={warning.sentence}
              onChange={(e) => patch({ sentence: e.target.value })}
              placeholder="Sentence I must type"
              className={inputCls}
            />
          )}

          {warning.challenge === "wait" && (
            <div className="flex flex-col gap-2">
              <Segmented
                value={warning.waitType}
                options={[
                  { value: "fixed", label: "Fixed time" },
                  { value: "dynamic", label: "Dynamic time" },
                ]}
                onChange={(waitType) => patch({ waitType })}
              />
              <label className="text-sm flex items-center gap-2">
                Wait
                <input
                  type="number"
                  min={0}
                  value={warning.waitSeconds}
                  onChange={(e) => patch({ waitSeconds: Math.max(0, Number(e.target.value)) })}
                  className={`${inputCls} w-16`}
                />
                seconds
              </label>
            </div>
          )}

          <label className="text-sm flex items-center gap-2">
            Brief pause of
            <input
              type="number"
              min={0}
              value={warning.delaySeconds}
              onChange={(e) => patch({ delaySeconds: Math.max(0, Number(e.target.value)) })}
              className={`${inputCls} w-16`}
            />
            seconds first
          </label>

          <textarea
            value={warning.customMessage}
            onChange={(e) => patch({ customMessage: e.target.value })}
            placeholder="A message to myself (optional)"
            rows={2}
            className={`${inputCls} resize-none`}
          />

          <label className="text-sm flex items-center gap-2 flex-wrap">
            Let me through
            <input
              type="number"
              min={0}
              value={warning.proceedLimit}
              onChange={(e) => patch({ proceedLimit: Math.max(0, Number(e.target.value)) })}
              className={`${inputCls} w-14`}
            />
            times every
            <input
              type="number"
              min={1}
              value={warning.proceedWindowMinutes}
              onChange={(e) => patch({ proceedWindowMinutes: Math.max(1, Number(e.target.value)) })}
              className={`${inputCls} w-14`}
            />
            minutes
          </label>
          <p className="text-xs text-muted">Set passes to 0 for no limit.</p>
        </div>
      )}
    </div>
  );
}
