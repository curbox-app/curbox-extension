import { Component, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DAY_LABELS } from "../lib/time";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition active:scale-[0.98] disabled:opacity-40";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-card px-5 py-3 text-sm font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40";
export const btnGhost = "inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium text-muted transition hover:text-ink";
export const inputCls =
  "w-full rounded-2xl bg-card px-4 py-3 text-sm text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--ring)]";
export const selectCls =
  "w-full rounded-2xl bg-card px-4 py-3 text-sm text-ink outline-none focus:ring-2 focus:ring-[var(--ring)]";

// Shared form primitives used by the blocker editors.

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

/** Okay and Cancel at the foot of a sheet, like an Android alert dialog. */
export function SheetActions({ onCancel, onOkay, okay = "Okay" }: { onCancel: () => void; onOkay: () => void; okay?: string }) {
  return (
    <div className="flex justify-end gap-3 border-t border-line bg-card px-6 py-3">
      <button type="button" onClick={onCancel} className={btnGhost}>
        Cancel
      </button>
      <button type="button" onClick={onOkay} className={btnPrimary}>
        {okay}
      </button>
    </div>
  );
}


export function GroupList<T extends { id: string; name: string; enabled: boolean }>({
  groups,
  empty,
  describe,
  onOpen,
  onChange,
  onAdd,
}: {
  groups: T[];
  empty: string;
  describe: (group: T) => string;
  onOpen: (group: T) => void;
  onChange: (groups: T[]) => void;
  onAdd: () => void;
}) {
  return (
    <div className="flex flex-col gap-2">
      {groups.length === 0 && <p className="py-2 text-sm text-muted">{empty}</p>}
      {groups.map((group) => (
        <div key={group.id} className="flex items-center justify-between border-b border-line/70 py-3">
          <button
            className="-mx-2 flex-1 rounded-xl px-2 py-1 text-left transition-colors hover:bg-state"
            onClick={() => onOpen(group)}
          >
            <p className="text-sm">{group.name}</p>
            <p className="text-xs text-muted">{describe(group)}</p>
          </button>
          <div className="flex items-center gap-3 pl-3">
            <Toggle
              on={group.enabled}
              onChange={(on) => onChange(groups.map((g) => (g.id === group.id ? { ...g, enabled: on } : g)))}
            />
            <button
              onClick={() => onChange(groups.filter((g) => g.id !== group.id))}
              className="text-xs text-faint transition-colors hover:text-ink"
            >
              Remove
            </button>
          </div>
        </div>
      ))}
      <button onClick={onAdd} className={`mt-3 self-start ${btnOutline}`}>
        + New group
      </button>
    </div>
  );
}

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
