import { browser } from "#imports";
import { Component, useMemo, useState, type ReactNode } from "react";
import type { DateKey, UsageHistory } from "../lib/types";
import { DAY_LABELS, dayLabel, msToWidget, todayKey, totalSublabel, weekKeys, weekRangeLabel } from "../lib/time";
import { dayTotal, domainsForDay, type DomainRow } from "../lib/stats";
import { randomAscii } from "../lib/ascii";
import { siteCategory, siteName } from "../lib/site";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition active:scale-[0.98] disabled:opacity-40";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-card px-5 py-3 text-sm font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40";
export const btnGhost = "inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium text-muted transition hover:text-ink";
export const inputCls =
  "w-full rounded-2xl bg-card px-4 py-3 text-sm text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--ring)]";
export const selectCls =
  "w-full rounded-2xl bg-card px-4 py-3 text-sm text-ink outline-none focus:ring-2 focus:ring-[var(--ring)]";

function usageEyebrow(key: DateKey): string {
  const raw = totalSublabel(key);
  if (raw.startsWith("Total · ")) return `TOTAL · ${raw.slice("Total · ".length)}`;
  return "TOTAL · Today";
}

function UsageHeader({ day, ms, compact }: { day: DateKey; ms: number; compact?: boolean }) {
  return (
    <div className={`flex items-start justify-between ${compact ? "pt-6" : "pt-[100px]"}`}>
      <div>
        <p className="text-[11px] font-medium tracking-[0.04em] text-muted">{usageEyebrow(day)}</p>
        <p className="font-display tnum mt-1 text-[56px] leading-none text-ink">{msToWidget(ms)}</p>
      </div>
    </div>
  );
}

function AsciiWatermark({ ascii, compact }: { ascii: string; compact?: boolean }) {
  return (
    <div
      className={`pointer-events-none absolute inset-x-0 top-0 z-0 flex items-start justify-start overflow-hidden ${compact ? "h-[220px]" : "h-[380px]"}`}
      style={{
        maskImage: "linear-gradient(to bottom, #000 42%, transparent 96%)",
        WebkitMaskImage: "linear-gradient(to bottom, #000 42%, transparent 96%)",
      }}
    >
      <pre
        aria-hidden="true"
        className="m-0 w-max select-none whitespace-pre text-left font-mono text-[7px] leading-[0.85] text-faint opacity-80"
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
      <span className="font-display grid h-10 w-10 shrink-0 place-items-center rounded-full bg-tertiary-chip text-lg leading-none text-ink">
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
      className="h-10 w-10 shrink-0 rounded-full bg-tertiary-chip object-cover"
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
  const barArea = 118;
  return (
    <div className="flex h-[168px] flex-col px-[12%]">
      <div className="flex flex-1 items-end justify-between">
        {keys.map((key, i) => {
          const has = totals[i] > 0;
          const height = has ? Math.max(8, Math.round((totals[i] / max) * barArea)) : 0;
          return (
            <button
              key={key}
              onClick={() => onSelect(key)}
              aria-label={`${dayLabel(key)} ${msToWidget(totals[i])}`}
              className="flex h-full flex-1 items-end justify-center"
            >
              <span
                style={{ height }}
                className="w-[15px] rounded-[8px] bg-accent transition-all duration-300 ease-out"
              />
            </button>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between">
        {keys.map((key) => (
          <span
            key={key}
            className={`flex-1 text-center text-[11px] ${
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

function pathLabel(path: string): string {
  if (path === "/" || path === "") return "Home";
  return path;
}

function DomainItem({ row }: { row: DomainRow }) {
  const extra = row.paths.filter((p) => p.path !== "/");
  const [open, setOpen] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const thread = extra.length > 0 ? extra : row.paths;
  const shown = showAll ? thread : thread.slice(0, 5);
  const hidden = thread.length - shown.length;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-3.5 py-3 text-left"
        aria-expanded={extra.length > 0 ? open : undefined}
        onClick={() => extra.length > 0 && setOpen((v) => !v)}
      >
        <Favicon domain={row.domain} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate text-sm font-medium text-ink">{siteName(row.domain)}</span>
          <span className="mt-px text-[11px] uppercase tracking-[0.06em] text-faint">{siteCategory(row.domain)}</span>
        </span>
        <span className="tnum shrink-0 text-sm text-muted">{msToWidget(row.ms)}</span>
        {extra.length > 0 && (
          <svg
            viewBox="0 0 24 24"
            width="16"
            height="16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.7"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            className={`shrink-0 text-faint transition ${open ? "rotate-90" : ""}`}
          >
            <path d="m9 6 6 6-6 6" />
          </svg>
        )}
      </button>
      {open && extra.length > 0 && (
        <div className="-mt-1 flex flex-col pb-2 pl-[54px] pr-1">
          {shown.map((p, i) => {
            const last = i === shown.length - 1 && hidden === 0;
            return (
              <p key={p.path} className="truncate py-1 text-xs text-faint">
                {last ? "└" : "├"}&nbsp;&nbsp;{pathLabel(p.path)} • {msToWidget(p.ms)}
              </p>
            );
          })}
          {hidden > 0 && (
            <button
              type="button"
              onClick={() => setShowAll(true)}
              className="py-1 text-left text-xs text-primary"
            >
              └&nbsp;&nbsp;See more pages
            </button>
          )}
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

function Chevron({ dir }: { dir: "left" | "right" }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={dir === "right" ? "rotate-180" : ""}>
      <path d="M14.5 6.5 8.5 12l6 5.5" />
    </svg>
  );
}

export function UsageView({ usage, compact }: { usage: UsageHistory; compact?: boolean }) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [selected, setSelected] = useState(todayKey());
  const keys = useMemo(() => weekKeys(weekOffset), [weekOffset]);
  const ascii = useMemo(() => randomAscii(), []);

  const rows = useMemo(() => domainsForDay(usage, selected), [usage, selected]);
  const total = useMemo(() => rows.reduce((s, r) => s + r.ms, 0), [rows]);
  const isToday = selected === todayKey();

  return (
    <div className="rise relative">
      <AsciiWatermark ascii={ascii} compact={compact} />
      <div className="relative z-10 px-4">
        <UsageHeader day={selected} ms={total} compact={compact} />
        <div className="mt-6">
          <WeeklyBarGraph usage={usage} keys={keys} selected={selected} onSelect={setSelected} />
          <div className="mt-5 flex items-center py-2 text-ink">
            <button
              type="button"
              onClick={() => setWeekOffset((o) => o + 1)}
              aria-label="Previous week"
              className="grid h-12 w-10 place-items-center"
            >
              <Chevron dir="left" />
            </button>
            <span className="tnum flex-1 text-center text-sm">{weekRangeLabel(keys)}</span>
            <button
              type="button"
              onClick={() => setWeekOffset((o) => Math.max(0, o - 1))}
              disabled={weekOffset === 0}
              aria-label="Next week"
              className="grid h-12 w-10 place-items-center disabled:opacity-25"
            >
              <Chevron dir="right" />
            </button>
          </div>
        </div>
        <div className="mt-6">
          <DomainList
            rows={rows}
            emptyMessage={isToday ? "Nothing yet today. Enjoy the quiet." : "No sites recorded that day."}
          />
        </div>
      </div>
    </div>
  );
}

// Shared form primitives used by the blocker editors.

export function MatcherList({
  label,
  matchers,
  onChange,
}: {
  label: string;
  matchers: string[];
  onChange: (matchers: string[]) => void;
}) {
  const [entry, setEntry] = useState("");
  const add = () => {
    const clean = entry.trim().toLowerCase();
    if (clean && !matchers.includes(clean)) onChange([...matchers, clean]);
    setEntry("");
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="label">{label}</p>
      <div className="flex gap-2">
        <input
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          placeholder="youtube.com or youtube.com/shorts"
          className={`${inputCls} flex-1`}
        />
        <button onClick={add} className={btnOutline}>
          Add
        </button>
      </div>
      <div className="flex flex-col">
        {matchers.map((m) => (
          <div key={m} className="flex items-center justify-between border-b border-line/70 py-2">
            <span className="font-mono text-sm">{m}</span>
            <button
              onClick={() => onChange(matchers.filter((x) => x !== m))}
              className="text-xs text-faint transition-colors hover:text-ink"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

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
