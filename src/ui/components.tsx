import { Component, useMemo, useState, type ReactNode } from "react";
import type { DateKey, UsageHistory } from "../lib/types";
import { dayLabel, msToHuman, todayKey, weekKeys, weekRangeLabel } from "../lib/time";
import { dayTotal, domainsForDay, type DomainRow } from "../lib/stats";

export function Stat({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="flex flex-col items-center text-center">
      <span className="text-xs uppercase tracking-widest text-muted">{label}</span>
      <span className="font-display text-6xl leading-none mt-1">{msToHuman(ms)}</span>
    </div>
  );
}

function WeeklyBarGraph({
  usage,
  keys,
  selected,
  onSelect,
}: {
  usage: UsageHistory;
  keys: DateKey[];
  selected: DateKey;
  onSelect: (key: DateKey) => void;
}) {
  const totals = keys.map((k) => dayTotal(usage, k));
  const max = Math.max(1, ...totals);
  return (
    <div className="flex items-end justify-between gap-2 h-28">
      {keys.map((key, i) => {
        const active = key === selected;
        const height = Math.max(4, Math.round((totals[i] / max) * 88));
        return (
          <button key={key} onClick={() => onSelect(key)} className="flex flex-1 flex-col items-center gap-2 group">
            <div className="flex flex-1 items-end w-full justify-center">
              <div
                style={{ height }}
                className={`w-2.5 rounded-full transition-all ${active ? "bg-ink" : "bg-line group-hover:bg-muted"}`}
              />
            </div>
            <span className={`text-[11px] ${active ? "text-ink" : "text-muted"}`}>{dayLabel(key)}</span>
          </button>
        );
      })}
    </div>
  );
}

function DomainItem({ row }: { row: DomainRow }) {
  const [open, setOpen] = useState(false);
  const hasPaths = row.paths.length > 1;
  return (
    <div className="border-b border-line py-3">
      <button className="flex w-full items-center justify-between text-left" onClick={() => hasPaths && setOpen((v) => !v)}>
        <span className="text-sm">{row.domain}</span>
        <span className="text-sm text-muted">{msToHuman(row.ms)}</span>
      </button>
      {open && (
        <div className="mt-2 flex flex-col gap-1.5 pl-1">
          {row.paths.slice(0, 6).map((p) => (
            <div key={p.path} className="flex items-center justify-between text-xs text-muted">
              <span className="truncate pr-3">{p.path}</span>
              <span className="shrink-0">{msToHuman(p.ms)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DomainList({ rows }: { rows: DomainRow[] }) {
  if (rows.length === 0) {
    return <p className="text-center text-sm text-muted py-8">Nothing yet today. Enjoy the quiet.</p>;
  }
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <DomainItem key={row.domain} row={row} />
      ))}
    </div>
  );
}

export function UsageView({ usage }: { usage: UsageHistory }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState(todayKey());
  const keys = useMemo(() => weekKeys(weekOffset), [weekOffset]);

  const rows = useMemo(() => domainsForDay(usage, selected), [usage, selected]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.ms, 0), [rows]);
  const isToday = selected === todayKey();

  return (
    <div className="flex flex-col gap-5">
      <Stat label={isToday ? "Total today" : selected} ms={total} />
      <WeeklyBarGraph usage={usage} keys={keys} selected={selected} onSelect={setSelected} />
      <div className="flex items-center justify-center gap-4 text-xs text-muted">
        <button onClick={() => setWeekOffset((o) => o + 1)} className="px-2 py-1">
          ‹
        </button>
        <span>{weekRangeLabel(keys)}</span>
        <button
          onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
          disabled={weekOffset === 0}
          className="px-2 py-1 disabled:opacity-30"
        >
          ›
        </button>
      </div>
      <DomainList rows={rows} />
    </div>
  );
}

// Shared form primitives used by the blocker editors.

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`flex h-5 w-9 items-center rounded-full p-0.5 transition-colors ${on ? "bg-ink" : "bg-line"}`}
    >
      <span className={`h-4 w-4 rounded-full bg-bg transition-transform ${on ? "translate-x-4" : ""}`} />
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex gap-2 flex-wrap">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-full py-1.5 px-3 text-xs border whitespace-nowrap ${
            value === o.value ? "border-ink" : "border-line text-muted"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

const DAY_LABELS = ["S", "M", "T", "W", "T", "F", "S"];

export function DayChips({ active, onToggle }: { active: boolean[]; onToggle: (i: number) => void }) {
  return (
    <div className="flex gap-1">
      {DAY_LABELS.map((label, i) => (
        <button
          key={i}
          onClick={() => onToggle(i)}
          className={`h-8 w-8 rounded-full text-xs border ${active[i] ? "border-ink" : "border-line text-muted"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full accent-ink"
    />
  );
}

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="border border-line rounded-2xl p-5 text-sm">
          <p className="mb-2">Something tripped up on this screen.</p>
          <p className="text-xs text-muted break-words">{this.state.error.message}</p>
          <button
            onClick={() => this.setState({ error: null })}
            className="mt-3 rounded-full border border-ink px-4 py-1.5 text-xs"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
