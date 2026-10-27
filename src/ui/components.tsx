import { Component, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { DAY_LABELS } from "../lib/time";

export const btnPrimary =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-primary px-5 py-3 text-sm font-semibold text-on-primary transition active:scale-[0.98] disabled:opacity-40";
export const btnOutline =
  "inline-flex items-center justify-center gap-2 rounded-2xl bg-card px-5 py-3 text-sm font-semibold text-ink transition active:scale-[0.98] disabled:opacity-40";
export const btnGhost = "inline-flex items-center justify-center gap-2 rounded-2xl px-3 py-2 text-sm font-medium text-muted transition hover:text-ink";
export const inputCls =
  "w-full rounded-2xl bg-card px-4 py-3 text-sm text-ink outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--ring)]";

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

export interface DropdownOption<T extends string> {
  value: T;
  label: string;
  description?: string;
  recommended?: boolean;
}

// The app's own dropdown instead of a native select, so rows can carry a
// description and a Recommended badge like Android, and look the same on every
// browser. The menu lives in a portal so scrolling sheets never clip it.
export function Dropdown<T extends string>({
  value,
  options,
  onChange,
  label,
  placeholder = "Select",
  compact,
  ariaLabel,
}: {
  value: T;
  options: DropdownOption<T>[];
  onChange: (value: T) => void;
  label?: string;
  placeholder?: string;
  compact?: boolean;
  ariaLabel?: string;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);
  const selected = options.find((option) => option.value === value);

  const show = () => {
    setActive(Math.max(0, options.findIndex((option) => option.value === value)));
    setOpen(true);
  };
  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const pick = (index: number) => {
    const option = options[index];
    if (option) onChange(option.value);
    close();
  };

  // Open under the field, or above it when the screen has more room there.
  useLayoutEffect(() => {
    if (!open) return;
    const measure = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const gap = 6;
      const below = window.innerHeight - rect.bottom - gap - 8;
      const above = rect.top - gap - 8;
      const width = Math.min(window.innerWidth - 16, Math.max(rect.width, compact ? 180 : 0));
      const left = Math.min(Math.max(8, compact ? rect.right - width : rect.left), window.innerWidth - width - 8);
      const up = below < 240 && above > below;
      setPlace(
        up
          ? { left, width, bottom: window.innerHeight - rect.top + gap, maxHeight: Math.min(360, above) }
          : { left, width, top: rect.bottom + gap, maxHeight: Math.min(360, below) },
      );
    };
    measure();
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
    };
  }, [open, compact]);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) close(false);
    };
    document.addEventListener("pointerdown", onDown);
    return () => document.removeEventListener("pointerdown", onDown);
  }, [open]);

  useEffect(() => {
    if (open) menu.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const onKeyDown = (event: ReactKeyboardEvent) => {
    const last = options.length - 1;
    const keys: Record<string, () => void> = {
      ArrowDown: () => (open ? setActive((i) => Math.min(last, i + 1)) : show()),
      ArrowUp: () => (open ? setActive((i) => Math.max(0, i - 1)) : show()),
      Home: () => open && setActive(0),
      End: () => open && setActive(last),
      Enter: () => (open ? pick(active) : show()),
      " ": () => (open ? pick(active) : show()),
      Escape: () => open && close(),
      Tab: () => open && close(false),
    };
    const run = keys[event.key];
    if (!run) return;
    if (event.key !== "Tab") event.preventDefault();
    // Escape closes only the menu, not a sheet behind it.
    if (event.key === "Escape" && open) event.stopPropagation();
    run();
  };

  const listId = `${id}-list`;
  const optionId = (index: number) => `${id}-option-${index}`;

  return (
    <div className={compact ? "inline-flex" : "flex flex-col gap-1.5"}>
      {label && (
        <span id={`${id}-label`} className="label">
          {label}
        </span>
      )}
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-labelledby={label ? `${id}-label ${id}-value` : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-activedescendant={open ? optionId(active) : undefined}
        onClick={() => (open ? close() : show())}
        onKeyDown={onKeyDown}
        className={
          compact
            ? "inline-flex items-center gap-1.5 rounded-xl px-2 py-1 text-xs text-muted transition-colors hover:bg-state hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
            : "flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left text-sm text-ink transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)]"
        }
      >
        <span id={`${id}-value`} className={`min-w-0 flex-1 truncate ${selected ? "" : "text-faint"}`}>
          {selected?.label ?? placeholder}
        </span>
        <svg
          viewBox="0 0 24 24"
          width={compact ? 12 : 16}
          height={compact ? 12 : 16}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          className={`shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>
      {open &&
        place &&
        createPortal(
          <ul
            ref={menu}
            id={listId}
            role="listbox"
            aria-label={label ?? ariaLabel}
            style={{ position: "fixed", left: place.left, width: place.width, top: place.top, bottom: place.bottom, maxHeight: place.maxHeight }}
            className="rise z-50 overflow-y-auto overscroll-contain rounded-2xl bg-card p-1.5 shadow-float"
          >
            {options.map((option, index) => {
              const isSelected = option.value === value;
              return (
                <li
                  key={option.value}
                  id={optionId(index)}
                  data-index={index}
                  role="option"
                  aria-selected={isSelected}
                  onPointerEnter={() => setActive(index)}
                  onClick={() => pick(index)}
                  className={`flex cursor-pointer items-start gap-3 rounded-xl px-3 py-2.5 transition-colors ${index === active ? "bg-state" : ""}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={`text-sm ${isSelected ? "font-medium text-ink" : "text-ink"}`}>{option.label}</span>
                      {option.recommended && (
                        <span className="rounded-full bg-primary/15 px-2 py-0.5 text-[10px] font-semibold tracking-wide text-primary">Recommended</span>
                      )}
                    </span>
                    {option.description && <span className="mt-0.5 block text-xs leading-snug text-muted">{option.description}</span>}
                  </span>
                  <span className={`mt-0.5 shrink-0 text-sm text-primary ${isSelected ? "" : "invisible"}`} aria-hidden="true">
                    ✓
                  </span>
                </li>
              );
            })}
          </ul>,
          document.body,
        )}
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
