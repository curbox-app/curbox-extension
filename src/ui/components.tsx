import { browser } from "#imports";
import { Component, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { DateKey, UsageHistory } from "../lib/types";
import { DAY_LABELS, dayLabel, msToWidget, todayKey, totalSublabel, weekKeys, weekRangeLabel } from "../lib/time";
import { dayTotal, domainsForDay, type DomainRow } from "../lib/stats";
import { randomAscii } from "../lib/ascii";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition active:scale-[0.98] disabled:opacity-40";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-card px-5 py-3 text-sm font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40";
export const btnGhost = "inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium text-muted transition hover:text-ink";
export const inputCls =
  "w-full rounded-2xl bg-card px-4 py-3 text-sm text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--ring)]";
export const selectCls =
  "w-full rounded-2xl bg-card px-4 py-3 text-sm text-ink outline-none focus:ring-2 focus:ring-[var(--ring)]";

function UsageHeader({ subLabel, ms }: { subLabel: string; ms: number }) {
  return (
    <div className="flex flex-col items-center pb-2 pt-16 text-center">
      <span className="label">{subLabel}</span>
      <span className="font-display tnum mt-2 text-[56px] font-bold leading-[0.85] tracking-tight text-ink">
        {msToWidget(ms)}
      </span>
    </div>
  );
}

function AsciiWatermark({ ascii }: { ascii: string }) {
  const ref = useRef<HTMLPreElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = ref.current;
    const parent = el?.parentElement;
    if (!el || !parent) return;
    const natural = el.scrollWidth;
    const avail = parent.clientWidth;
    setScale(natural > avail ? avail / natural : 1);
  }, [ascii]);

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-0 flex justify-center">
      <pre
        ref={ref}
        aria-hidden="true"
        style={{ transform: `scale(${scale})`, transformOrigin: "top center" }}
        className="m-0 w-max select-none whitespace-pre text-center font-mono text-[7px] leading-[0.85] text-faint opacity-50"
      >
        {ascii}
      </pre>
    </div>
  );
}

function Favicon({ domain }: { domain: string }) {
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <span className="font-display grid h-10 w-10 shrink-0 place-items-center rounded-[10px] bg-surface-2 text-lg leading-none text-muted">
        {domain[0]?.toUpperCase() ?? "?"}
      </span>
    );
  }
  const base = (browser.runtime.getURL as (p: string) => string)("/_favicon/");
  const src = `${base}?pageUrl=${encodeURIComponent(`https://${domain}`)}&size=64`;
  return (
    <img
      src={src}
      alt=""
      width={40}
      height={40}
      onError={() => setFailed(true)}
      className="h-10 w-10 shrink-0 rounded-[10px] bg-surface-2 object-contain"
    />
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
  const barArea = 132; // px of drawable height above the day labels
  return (
    <div className="flex h-[180px] flex-col px-[7.5%]">
      <div className="flex flex-1 items-end justify-between gap-2">
        {keys.map((key, i) => {
          const active = key === selected;
          const has = totals[i] > 0;
          const height = has ? Math.max(6, Math.round((totals[i] / max) * barArea)) : 0;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              aria-label={`${dayLabel(key)} ${msToWidget(totals[i])}`}
              className="group flex h-full flex-1 items-end justify-center"
            >
              <div
                style={{ height }}
                className={`w-full max-w-[12px] rounded-[6px] transition-all duration-300 ease-out ${
                  active ? "bg-primary" : "bg-primary/35 group-hover:bg-primary/55"
                }`}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between gap-2">
        {keys.map((key) => (
          <span
            key={key}
            className={`flex-1 text-center text-[11px] transition-colors ${
              key === selected ? "font-semibold text-ink" : "text-muted"
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
  const pages = row.paths.length === 1 ? "1 page" : `${row.paths.length} pages`;
  const shown = row.paths.slice(0, 6);
  return (
    <div>
      <button
        className="-mx-1 flex w-full items-center gap-3.5 rounded-xl px-1 py-3 text-left transition-colors hover:bg-state"
        onClick={() => hasPaths && setOpen((v) => !v)}
      >
        <Favicon domain={row.domain} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm text-ink">{row.domain}</span>
          <span className="label mt-0.5">{pages}</span>
        </span>
        <span className="tnum shrink-0 text-sm text-muted">{msToWidget(row.ms)}</span>
      </button>
      {open && (
        <div className="flex flex-col gap-1 pb-2 pl-[54px] pr-1">
          {shown.map((p, i) => (
            <div key={p.path} className="flex items-center gap-2 font-mono text-xs text-muted">
              <span className="shrink-0 text-faint">{i === shown.length - 1 ? "└" : "├"}</span>
              <span className="truncate">{p.path}</span>
              <span className="text-faint">•</span>
              <span className="tnum ml-auto shrink-0">{msToWidget(p.ms)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DomainList({ rows, emptyMessage }: { rows: DomainRow[]; emptyMessage: string }) {
  if (rows.length === 0) {
    return (
      <div className="flex flex-col items-center gap-4 py-12 text-center">
        <span className="h-2 w-2 animate-pulse rounded-full bg-faint" />
        <p className="text-sm text-muted">{emptyMessage}</p>
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
  const ascii = useMemo(() => randomAscii(), []);

  const rows = useMemo(() => domainsForDay(usage, selected), [usage, selected]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.ms, 0), [rows]);
  const isToday = selected === todayKey();

  return (
    <div className="rise relative">
      <AsciiWatermark ascii={ascii} />
      <div className="relative z-10 flex flex-col gap-7">
        <UsageHeader subLabel={totalSublabel(selected)} ms={total} />
        <div>
          <WeeklyBarGraph usage={usage} keys={keys} selected={selected} onSelect={setSelected} />
          <div className="mt-3 flex items-center justify-center gap-2 text-xs text-muted">
            <NavBtn onClick={() => setWeekOffset((o) => o + 1)}>‹</NavBtn>
            <span className="tnum min-w-[150px] text-center">{weekRangeLabel(keys)}</span>
            <NavBtn onClick={() => setWeekOffset((o) => Math.max(0, o - 1))} disabled={weekOffset === 0}>
              ›
            </NavBtn>
          </div>
        </div>
        <DomainList
          rows={rows}
          emptyMessage={isToday ? "Nothing yet today. Enjoy the quiet." : "No sites recorded that day."}
        />
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
        on ? "bg-primary" : "bg-line"
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full shadow-sm transition-transform duration-300 ease-out ${
          on ? "translate-x-[18px] bg-white" : "translate-x-[3px] bg-white"
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
            active[i] ? "bg-primary text-on-primary" : "bg-surface-2 text-muted hover:text-ink"
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
