import { Component, useMemo, useState, type ReactNode } from "react";
import type { DateKey, UsageHistory } from "../lib/types";
import { DAY_LABELS, dayLabel, msToHuman, todayKey, weekKeys, weekRangeLabel } from "../lib/time";
import { dayTotal, domainsForDay, type DomainRow } from "../lib/stats";

// Shared button and input recipes so every screen stays visually in sync.
export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-pill bg-ink px-6 py-2.5 text-sm font-medium text-bg shadow-soft transition-all duration-200 ease-out hover:shadow-float hover:-translate-y-px active:translate-y-0 active:scale-[0.98] disabled:opacity-40 disabled:shadow-none disabled:hover:translate-y-0";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-pill border border-line bg-surface px-5 py-2 text-sm font-medium text-ink transition-colors duration-200 hover:bg-state active:scale-[0.98]";
export const btnGhost = "text-sm text-muted transition-colors hover:text-ink";
export const inputCls =
  "bg-transparent border-b border-line py-1.5 px-1 text-sm transition-colors focus:outline-none focus:border-ink placeholder:text-faint";
export const selectCls =
  "w-full bg-transparent border-b border-line py-1.5 text-sm transition-colors focus:outline-none focus:border-ink";

export function Stat({ label, ms }: { label: string; ms: number }) {
  return (
    <div className="relative flex flex-col items-center overflow-hidden pt-7 pb-3 text-center">
      <div className="bloom" aria-hidden="true" />
      <span className="label relative">{label}</span>
      <span className="font-display tnum relative mt-3 text-[76px] leading-[0.78] tracking-tight">{msToHuman(ms)}</span>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      className={`shrink-0 text-faint transition-transform duration-300 ${open ? "rotate-180" : ""}`}
    >
      <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
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
    <div className="relative h-32">
      <div className="flex h-full items-end justify-between gap-1.5 pb-6">
        {keys.map((key, i) => {
          const active = key === selected;
          const has = totals[i] > 0;
          const height = has ? Math.max(8, Math.round((totals[i] / max) * 84)) : 3;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              aria-label={`${dayLabel(key)} ${msToHuman(totals[i])}`}
              className="group flex h-full flex-1 items-end justify-center"
            >
              <div
                style={{ height }}
                className={`w-full max-w-[13px] rounded-full transition-all duration-300 ease-out ${
                  active ? "bg-ink" : has ? "bg-line group-hover:bg-faint" : "bg-line/50"
                }`}
              />
            </button>
          );
        })}
      </div>
      <div className="pointer-events-none absolute inset-x-0 bottom-6 h-px bg-line/70" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-1.5">
        {keys.map((key) => (
          <span
            key={key}
            className={`flex-1 text-center text-[11px] transition-colors ${
              key === selected ? "font-medium text-ink" : "text-faint"
            }`}
          >
            {dayLabel(key)}
          </span>
        ))}
      </div>
    </div>
  );
}

function DomainItem({ row }: { row: DomainRow }) {
  const [open, setOpen] = useState(false);
  const hasPaths = row.paths.length > 1;
  return (
    <div className="border-b border-line/70 last:border-0">
      <button
        className="-mx-2 flex w-full items-center gap-3 rounded-xl px-2 py-3 text-left transition-colors hover:bg-state"
        onClick={() => hasPaths && setOpen((v) => !v)}
      >
        <span className="font-display grid h-9 w-9 shrink-0 place-items-center rounded-full bg-surface-2 text-lg leading-none text-muted">
          {row.domain[0]?.toUpperCase() ?? "?"}
        </span>
        <span className="flex-1 truncate text-sm">{row.domain}</span>
        {hasPaths && <Chevron open={open} />}
        <span className="tnum shrink-0 text-sm text-muted">{msToHuman(row.ms)}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1.5 pb-3 pl-12 pr-2">
          {row.paths.slice(0, 6).map((p) => (
            <div key={p.path} className="flex items-center justify-between text-xs text-muted">
              <span className="truncate pr-3">{p.path}</span>
              <span className="tnum shrink-0">{msToHuman(p.ms)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DomainList({ rows }: { rows: DomainRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="h-2 w-2 animate-pulse rounded-full bg-faint" />
        <p className="text-sm text-muted">Nothing yet today. Enjoy the quiet.</p>
      </div>
    );
  }
  return (
    <div className="flex flex-col">
      {rows.map((row) => (
        <DomainItem key={row.domain} row={row} />
      ))}
    </div>
  );
}

function NavBtn({ children, onClick, disabled }: { children: ReactNode; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="grid h-8 w-8 place-items-center rounded-full text-base text-muted transition-colors hover:bg-state hover:text-ink disabled:opacity-25 disabled:hover:bg-transparent"
    >
      {children}
    </button>
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
    <div className="rise flex flex-col gap-6">
      <Stat label={isToday ? "Total today" : selected} ms={total} />
      <div className="card px-4 pb-3 pt-4">
        <WeeklyBarGraph usage={usage} keys={keys} selected={selected} onSelect={setSelected} />
        <div className="mt-1 flex items-center justify-center gap-2 text-xs text-muted">
          <NavBtn onClick={() => setWeekOffset((o) => o + 1)}>‹</NavBtn>
          <span className="tnum min-w-[150px] text-center">{weekRangeLabel(keys)}</span>
          <NavBtn onClick={() => setWeekOffset((o) => Math.max(0, o - 1))} disabled={weekOffset === 0}>
            ›
          </NavBtn>
        </div>
      </div>
      <div>
        <p className="label mb-1">{isToday ? "Sites today" : "Sites"}</p>
        <DomainList rows={rows} />
      </div>
    </div>
  );
}

// Shared form primitives used by the blocker editors.

export function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      role="switch"
      aria-checked={on}
      className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors duration-300 ${
        on ? "bg-ink" : "bg-surface-2"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform duration-300 ease-out ${
          on ? "translate-x-[18px] bg-bg" : "translate-x-[3px] bg-faint"
        }`}
      />
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
    <div className="inline-flex w-full gap-1 rounded-pill bg-surface-2 p-1">
      {options.map((o) => {
        const sel = value === o.value;
        return (
          <button
            key={o.value}
            onClick={() => onChange(o.value)}
            className={`flex-1 whitespace-nowrap rounded-pill px-3 py-1.5 text-xs font-medium transition-all duration-200 ${
              sel ? "bg-surface text-ink shadow-soft" : "text-muted hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function DayChips({ active, onToggle }: { active: boolean[]; onToggle: (i: number) => void }) {
  return (
    <div className="flex gap-1.5">
      {DAY_LABELS.map((label, i) => (
        <button
          key={i}
          onClick={() => onToggle(i)}
          className={`h-9 w-9 rounded-full text-xs font-medium transition-all duration-200 ${
            active[i] ? "bg-ink text-bg" : "bg-surface-2 text-muted hover:text-ink"
          }`}
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
      className="slider"
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
        <div className="card p-5 text-sm">
          <p className="mb-2">Something tripped up on this screen.</p>
          <p className="break-words text-xs text-muted">{this.state.error.message}</p>
          <button onClick={() => this.setState({ error: null })} className={`mt-4 ${btnOutline}`}>
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
