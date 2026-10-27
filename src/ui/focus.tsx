import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { browser } from "#imports";
import type { FocusGroup, FocusLogEntry, FocusMode, FocusSession } from "../lib/types";
import { newFocusGroup, POMODORO } from "../lib/types";
import { dateKey, dayLabel, lastNDays, msToHuman } from "../lib/time";
import { startSession } from "../core/focus";
import { currentRound } from "../core/pomodoro";
import { sendToBackground } from "../lib/messages";
import { Dropdown, EditorSheet, Segmented, SheetActions, Toggle, btnOutline, btnPrimary, inputCls } from "./components";
import { useDraft } from "./useDraft";

const MODE_OPTIONS: { value: FocusMode; label: string }[] = [
  { value: "only-these", label: "Block Selected" },
  { value: "all-except", label: "Block All Except Selected" },
];

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

// What the last session used, so the next one starts the same way (Android
// keeps these in AppPreferences).
interface FocusPrefs {
  minutes: number;
  groupId: string;
  pomodoro: boolean;
  breakMinutes: number;
  rounds: number;
}

const PREF_KEYS = {
  minutes: "ui.lastFocusDuration",
  groupId: "ui.lastFocusGroupId",
  pomodoro: "ui.lastPomodoroEnabled",
  breakMinutes: "ui.lastPomodoroBreak",
  rounds: "ui.lastPomodoroRounds",
} as const;

const DEFAULT_PREFS: FocusPrefs = {
  minutes: 25,
  groupId: "",
  pomodoro: false,
  breakMinutes: POMODORO.defaultBreakMinutes,
  rounds: POMODORO.defaultRounds,
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}

function useFocusPrefs() {
  const [prefs, setPrefs] = useState(DEFAULT_PREFS);
  useEffect(() => {
    // Anything changed before the saved values arrive wins over them.
    void browser.storage.local.get(Object.values(PREF_KEYS)).then((stored) =>
      setPrefs((current) => current !== DEFAULT_PREFS ? current : {
        minutes: clampInt(stored[PREF_KEYS.minutes], 1, POMODORO.maxFocusMinutes, DEFAULT_PREFS.minutes),
        groupId: typeof stored[PREF_KEYS.groupId] === "string" ? (stored[PREF_KEYS.groupId] as string) : "",
        pomodoro: stored[PREF_KEYS.pomodoro] === true,
        breakMinutes: clampInt(stored[PREF_KEYS.breakMinutes], 1, POMODORO.maxBreakMinutes, DEFAULT_PREFS.breakMinutes),
        rounds: clampInt(stored[PREF_KEYS.rounds], POMODORO.minRounds, POMODORO.maxRounds, DEFAULT_PREFS.rounds),
      }),
    );
  }, []);
  const save = (next: FocusPrefs) =>
    browser.storage.local.set(Object.fromEntries(Object.entries(PREF_KEYS).map(([field, key]) => [key, next[field as keyof FocusPrefs]])));
  return [prefs, setPrefs, save] as const;
}

const TICK_PX = 20;
const MIN_MINUTES = 1;
const MAX_MINUTES = POMODORO.maxFocusMinutes;
const clampMinutes = (n: number) => Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));

// The scrubber under the big number, like Android's ruler: one tick a minute,
// a tall tick every five. While a session runs it follows the time left.
// Dragging is handled with pointer events, so touch, mouse and pen behave the
// same everywhere, and only the ticks on screen are drawn.
function Ruler({ value, onChange, locked }: { value: number; onChange: (minutes: number) => void; locked: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [pos, setPos] = useState(value);
  const posRef = useRef(value);
  const busy = useRef(false);
  const emitted = useRef(Math.round(value));
  const drag = useRef<{ id: number; x: number; from: number; samples: Array<{ t: number; x: number }> } | null>(null);
  const frame = useRef(0);
  const snapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = (next: number) => {
    const clamped = Math.min(MAX_MINUTES, Math.max(locked ? 0 : MIN_MINUTES, next));
    posRef.current = clamped;
    setPos(clamped);
    const minute = clampMinutes(Math.round(clamped));
    if (locked || minute === emitted.current) return;
    emitted.current = minute;
    onChange(minute);
  };

  const stopMotion = () => {
    cancelAnimationFrame(frame.current);
    if (snapTimer.current) clearTimeout(snapTimer.current);
    snapTimer.current = null;
  };

  // Ease onto the nearest whole minute, then hand control back to the value.
  const settle = () => {
    stopMotion();
    const target = clampMinutes(Math.round(posRef.current));
    const step = () => {
      const delta = target - posRef.current;
      if (Math.abs(delta) < 0.01) {
        show(target);
        busy.current = false;
        return;
      }
      show(posRef.current + delta * 0.3);
      frame.current = requestAnimationFrame(step);
    };
    step();
  };

  // Keep spinning after a flick, slowing down, like a native scroller.
  const fling = (velocity: number) => {
    stopMotion();
    let v = velocity;
    let last = performance.now();
    const step = (now: number) => {
      const dt = Math.min(64, now - last);
      last = now;
      v *= Math.pow(0.95, dt / 16);
      const next = posRef.current + v * dt;
      show(next);
      const atEdge = next <= MIN_MINUTES || next >= MAX_MINUTES;
      if (Math.abs(v) < 0.002 || atEdge) return settle();
      frame.current = requestAnimationFrame(step);
    };
    frame.current = requestAnimationFrame(step);
  };

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(() => setWidth(el.clientWidth));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Outside a gesture the ruler simply shows the value it is given.
  useEffect(() => {
    emitted.current = Math.round(value);
    if (busy.current && !locked) return;
    posRef.current = value;
    setPos(value);
  }, [value, locked]);

  useEffect(() => {
    if (locked) {
      stopMotion();
      busy.current = false;
      drag.current = null;
    }
  }, [locked]);

  useEffect(() => stopMotion, []);

  // A mouse wheel or trackpad nudges the ruler, then it snaps once it rests.
  useEffect(() => {
    const el = ref.current;
    if (!el || locked) return;
    const onWheel = (event: WheelEvent) => {
      const delta = Math.abs(event.deltaX) > Math.abs(event.deltaY) ? event.deltaX : event.deltaY;
      if (!delta) return;
      event.preventDefault();
      cancelAnimationFrame(frame.current);
      busy.current = true;
      show(posRef.current + delta / TICK_PX);
      if (snapTimer.current) clearTimeout(snapTimer.current);
      snapTimer.current = setTimeout(settle, 140);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [locked]);

  const onPointerDown = (event: ReactPointerEvent) => {
    if (locked || (event.pointerType === "mouse" && event.button !== 0)) return;
    stopMotion();
    busy.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: event.pointerId, x: event.clientX, from: posRef.current, samples: [{ t: event.timeStamp, x: event.clientX }] };
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    d.samples.push({ t: event.timeStamp, x: event.clientX });
    if (d.samples.length > 6) d.samples.shift();
    // Dragging left moves to higher minutes, as if pulling the strip along.
    show(d.from + (d.x - event.clientX) / TICK_PX);
  };

  const onPointerEnd = (event: ReactPointerEvent) => {
    const d = drag.current;
    if (!d || d.id !== event.pointerId) return;
    drag.current = null;
    const first = d.samples[0];
    const last = d.samples[d.samples.length - 1];
    const dt = last.t - first.t;
    const recent = event.timeStamp - last.t < 80;
    const velocity = dt > 0 && recent ? (first.x - last.x) / TICK_PX / dt : 0;
    if (Math.abs(velocity) > 0.015) fling(velocity);
    else settle();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    const step = { ArrowLeft: -1, ArrowRight: 1, ArrowDown: -1, ArrowUp: 1, PageDown: -5, PageUp: 5 }[event.key];
    if (locked || !step) return;
    event.preventDefault();
    onChange(clampMinutes(Math.round(value) + step));
  };

  const half = width / 2 / TICK_PX + 2;
  const first = Math.max(0, Math.floor(pos - half));
  const last = Math.min(MAX_MINUTES, Math.ceil(pos + half));
  const ticks = [];
  for (let minute = first; minute <= last; minute++) {
    ticks.push(
      <span
        key={minute}
        className={`absolute top-1/2 w-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full ${minute % 5 === 0 ? "h-9 bg-faint" : "h-5 bg-line"}`}
        style={{ left: minute * TICK_PX }}
      />,
    );
  }

  return (
    <div
      ref={ref}
      role="slider"
      tabIndex={locked ? -1 : 0}
      aria-label="Focus minutes"
      aria-valuemin={MIN_MINUTES}
      aria-valuemax={MAX_MINUTES}
      aria-valuenow={Math.round(value)}
      aria-readonly={locked}
      onKeyDown={onKeyDown}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerEnd}
      onPointerCancel={onPointerEnd}
      className={`relative h-[70px] select-none overflow-hidden rounded-xl outline-none [touch-action:pan-y] focus-visible:ring-2 focus-visible:ring-[var(--ring)] ${
        locked ? "" : "cursor-grab active:cursor-grabbing"
      }`}
    >
      <div className="absolute inset-y-0 left-0 will-change-transform" style={{ transform: `translate3d(${width / 2 - pos * TICK_PX}px,0,0)` }}>
        {ticks}
      </div>
      <span className="pointer-events-none absolute left-1/2 top-1/2 h-10 w-[3px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary" />
    </div>
  );
}

// The big number doubles as a text field, so minutes can be typed.
function MinutesField({ value, onChange }: { value: number; onChange: (minutes: number) => void }) {
  const [text, setText] = useState(String(value));
  const editing = useRef(false);

  useEffect(() => {
    if (!editing.current) setText(String(value));
  }, [value]);

  const commit = (raw: string) => {
    const minutes = Number(raw);
    if (raw && Number.isFinite(minutes) && minutes >= MIN_MINUTES) onChange(clampMinutes(Math.floor(minutes)));
  };

  // An invisible copy of the text sets the width, so the field fits any digits
  // exactly in this proportional font.
  const big = "font-display tnum text-[150px] leading-[0.8] [grid-area:1/1]";
  return (
    <span className="inline-grid">
      <span aria-hidden="true" className={`${big} invisible whitespace-pre`}>
        {text || " "}
      </span>
      <input
      type="text"
      inputMode="numeric"
      enterKeyHint="done"
      aria-label="Focus minutes"
      maxLength={4}
      size={1}
      value={text}
      onFocus={(e) => {
        editing.current = true;
        e.currentTarget.select();
      }}
      onChange={(e) => {
        const digits = e.target.value.replace(/\D/g, "").slice(0, 4);
        setText(digits);
        commit(digits);
      }}
      onBlur={() => {
        editing.current = false;
        setText(String(value));
      }}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === "Escape") e.currentTarget.blur();
        const step = { ArrowUp: 1, ArrowDown: -1 }[e.key];
        if (!step) return;
        e.preventDefault();
        const next = clampMinutes(value + step);
        setText(String(next));
        onChange(next);
      }}
      className={`${big} h-[120px] w-full min-w-0 bg-transparent p-0 text-ink caret-primary outline-none`}
      />
    </span>
  );
}

function describeGroup(group: FocusGroup): string {
  const count = group.domains.length;
  return `${count} website${count === 1 ? "" : "s"} ${group.mode === "only-these" ? "included" : "excluded"}`;
}

function phaseLabel(focus: FocusSession): string {
  const pomodoro = focus.pomodoro;
  if (!pomodoro) return focus.name;
  return pomodoro.phase === "focus"
    ? `${focus.name} · Focus ${currentRound(pomodoro)} of ${pomodoro.totalRounds}`
    : `${focus.name} · Break after focus ${pomodoro.completedRounds} of ${pomodoro.totalRounds}`;
}

const StatsIcon = () => (
  <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M18 20V10" />
    <path d="M12 20V4" />
    <path d="M6 20v-6" />
  </svg>
);

function FocusHome({
  focus,
  groups,
  minutes,
  onMinutes,
  onSetup,
  onStats,
}: {
  focus: FocusSession | null;
  groups: FocusGroup[];
  minutes: number;
  onMinutes: (minutes: number) => void;
  onSetup: () => void;
  onStats: () => void;
}) {
  const now = useNow(!!focus);
  const remaining = focus ? Math.max(0, focus.endsAt - now) : 0;
  const shownMinutes = focus ? Math.floor(remaining / 60_000) : minutes;
  const seconds = Math.floor((remaining % 60_000) / 1000);
  const action = focus
    ? focus.pomodoro
      ? "End Pomodoro"
      : "End Session"
    : groups.length === 0
      ? "Create Focus Group"
      : "Curb Me";

  return (
    <div className="flex min-h-[max(460px,calc(100dvh-9rem))] flex-col justify-end pb-6">
      {focus && <p className="text-base text-muted">{phaseLabel(focus)}</p>}
      <div className="flex items-start">
        {focus ? (
          <span className="font-display tnum text-[150px] leading-[0.8] text-ink">{shownMinutes}</span>
        ) : (
          <MinutesField value={minutes} onChange={onMinutes} />
        )}
        <span className="tnum ml-1 mt-3 text-xl text-ink">{focus ? `:${String(seconds).padStart(2, "0")}` : "mins"}</span>
      </div>
      <div className="mb-8 mt-6">
        <Ruler value={focus ? remaining / 60_000 : minutes} onChange={onMinutes} locked={!!focus} />
      </div>
      <div className="flex items-center gap-2">
        {!focus && (
          <button type="button" onClick={onStats} aria-label="Focus stats" className="grid h-12 w-12 shrink-0 place-items-center rounded-full text-ink transition-colors hover:bg-state">
            <StatsIcon />
          </button>
        )}
        <button
          type="button"
          disabled={!!focus && !focus.exitable}
          onClick={() => (focus ? void sendToBackground({ type: "endFocus" }) : onSetup())}
          className={`flex-1 ${btnPrimary}`}
        >
          {action}
        </button>
      </div>
      {focus && !focus.exitable && <p className="mt-3 text-center text-xs text-muted">I'll stay until the timer is done.</p>}
    </div>
  );
}

const IconButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    aria-label={label}
    className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl text-muted transition-colors hover:bg-state hover:text-ink"
  >
    {children}
  </button>
);

function NumberField({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (n: number) => void }) {
  return (
    <label className="flex flex-1 flex-col gap-1.5">
      <span className="label">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(clampInt(e.target.value, min, max, min))}
        className={`${inputCls} [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none`}
      />
    </label>
  );
}

type SheetView = { kind: "select" } | { kind: "edit"; group: FocusGroup; isNew: boolean } | { kind: "delete"; group: FocusGroup };

// Android's "A few final steps" bottom sheet: pick a group and pomodoro
// options, or create and edit groups without leaving it.
function FocusSetupSheet({
  groups,
  prefs,
  onPrefs,
  onChangeGroups,
  onStart,
  onClose,
}: {
  groups: FocusGroup[];
  prefs: FocusPrefs;
  onPrefs: (prefs: FocusPrefs) => void;
  onChangeGroups: (groups: FocusGroup[]) => void;
  onStart: (group: FocusGroup) => void;
  onClose: () => void;
}) {
  const fresh = () => newFocusGroup(`Focus ${groups.length + 1}`);
  const [view, setView] = useState<SheetView>(() =>
    groups.length === 0 ? { kind: "edit", group: fresh(), isNew: true } : { kind: "select" },
  );
  const selected = groups.find((g) => g.id === prefs.groupId) ?? groups[0];
  const backToSelect = () => (groups.length === 0 ? onClose() : setView({ kind: "select" }));

  if (view.kind === "edit") {
    return (
      <GroupEditor
        key={view.group.id}
        group={view.group}
        isNew={view.isNew}
        onCancel={backToSelect}
        onClose={onClose}
        onSave={(group) => {
          onChangeGroups(view.isNew ? [...groups, group] : groups.map((g) => (g.id === group.id ? group : g)));
          onPrefs({ ...prefs, groupId: group.id });
          setView({ kind: "select" });
        }}
      />
    );
  }

  if (view.kind === "delete") {
    return (
      <EditorSheet
        title="Delete Focus Group"
        subtitle={`Are you sure you want to delete ${view.group.name}? Your focus stats stay.`}
        onClose={onClose}
        nav={
          <SheetActions
            okay="Delete"
            onCancel={() => setView({ kind: "select" })}
            onOkay={() => {
              const rest = groups.filter((g) => g.id !== view.group.id);
              onChangeGroups(rest);
              if (rest.length === 0) setView({ kind: "edit", group: fresh(), isNew: true });
              else setView({ kind: "select" });
            }}
          />
        }
      >
        <span />
      </EditorSheet>
    );
  }

  return (
    <EditorSheet
      title="A few final steps"
      subtitle="Pick what I should hold back while you focus."
      onClose={onClose}
      nav={
        <div className="border-t border-line bg-card px-6 py-3">
          <button type="button" disabled={!selected} onClick={() => selected && onStart(selected)} className={`w-full ${btnPrimary}`}>
            Curb Me
          </button>
        </div>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <Dropdown
            label="Focus Group"
            value={selected?.id ?? ""}
            options={groups.map((g) => ({ value: g.id, label: g.name, description: describeGroup(g) }))}
            onChange={(groupId) => onPrefs({ ...prefs, groupId })}
          />
          {selected && <span className="text-xs text-muted">{describeGroup(selected)}</span>}
        </div>

        <div className="flex flex-col gap-2">
          <label className="flex items-center justify-between text-base text-ink">
            Pomodoro timer
            <Toggle on={prefs.pomodoro} onChange={(pomodoro) => onPrefs({ ...prefs, pomodoro })} />
          </label>
          <p className="text-sm text-muted">Repeat the selected focus time with a short break between each round.</p>
          {prefs.pomodoro && (
            <div className="mt-2 flex gap-3">
              <NumberField
                label="Break minutes"
                value={prefs.breakMinutes}
                min={1}
                max={POMODORO.maxBreakMinutes}
                onChange={(breakMinutes) => onPrefs({ ...prefs, breakMinutes })}
              />
              <NumberField
                label="Focus rounds"
                value={prefs.rounds}
                min={POMODORO.minRounds}
                max={POMODORO.maxRounds}
                onChange={(rounds) => onPrefs({ ...prefs, rounds })}
              />
            </div>
          )}
        </div>

        <div className="flex items-center gap-1">
          <button type="button" onClick={() => setView({ kind: "edit", group: fresh(), isNew: true })} className={btnOutline}>
            Create New Group
          </button>
          <span className="flex-1" />
          {selected && (
            <>
              <IconButton label={`Edit ${selected.name}`} onClick={() => setView({ kind: "edit", group: selected, isNew: false })}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
              </IconButton>
              <IconButton label={`Delete ${selected.name}`} onClick={() => setView({ kind: "delete", group: selected })}>
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
              </IconButton>
            </>
          )}
        </div>
      </div>
    </EditorSheet>
  );
}

function GroupEditor({
  group,
  isNew,
  onSave,
  onCancel,
  onClose,
}: {
  group: FocusGroup;
  isNew: boolean;
  onSave: (g: FocusGroup) => void;
  onCancel: () => void;
  onClose: () => void;
}) {
  const [draft, patch] = useDraft<FocusGroup>(group);
  const [entry, setEntry] = useState("");

  // Commas add several at once, like Android's Add Websites dialog.
  const addSites = () => {
    const sites = entry.split(",").map((s) => s.trim().toLowerCase()).filter((s) => s && !draft.domains.includes(s));
    if (sites.length > 0) patch({ domains: [...draft.domains, ...new Set(sites)] });
    setEntry("");
  };

  return (
    <EditorSheet
      title={isNew ? "Create a new group" : "Edit group"}
      subtitle="Use a Focus Group to start a focus session with your chosen websites in one tap."
      onClose={onClose}
      nav={<SheetActions okay="Save Group" onCancel={onCancel} onOkay={() => onSave({ ...draft, name: draft.name.trim() || "Untitled" })} />}
    >
      <div className="flex flex-col gap-5">
        <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="Enter Group Name" className={`${inputCls} text-base`} />

        <div className="flex flex-col gap-2">
          <p className="label">Websites</p>
          <div className="flex gap-2">
            <input
              value={entry}
              onChange={(e) => setEntry(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addSites()}
              placeholder="youtube.com, reddit.com"
              enterKeyHint="done"
              autoCapitalize="off"
              className={`${inputCls} flex-1`}
            />
            <button type="button" onClick={addSites} className={btnOutline}>
              Add
            </button>
          </div>
          <div className="flex flex-col">
            {draft.domains.map((m) => (
              <div key={m} className="flex items-center justify-between border-b border-line/70 py-2">
                <span className="font-mono text-sm">{m}</span>
                <button
                  type="button"
                  aria-label={`Remove ${m}`}
                  onClick={() => patch({ domains: draft.domains.filter((x) => x !== m) })}
                  className="px-2 text-xs text-faint transition-colors hover:text-ink"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="label">Select what happens when you open a website</p>
          <Segmented value={draft.mode} options={MODE_OPTIONS} onChange={(mode) => patch({ mode })} />
        </div>

        <label className="flex items-center justify-between text-sm">
          Let me quit mid sessions
          <Toggle on={draft.exitable} onChange={(exitable) => patch({ exitable })} />
        </label>
      </div>
    </EditorSheet>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl bg-surface-2 p-3 text-center">
      <p className="font-display tnum text-2xl leading-none">{value}</p>
      <p className="label mt-1.5">{label}</p>
    </div>
  );
}

function FocusStats({ log, groups }: { log: FocusLogEntry[]; groups: FocusGroup[] }) {
  const [filter, setFilter] = useState("all");
  const rows = filter === "all" ? log : log.filter((e) => e.groupId === filter);

  const sessions = rows.length;
  const totalMs = rows.reduce((s, e) => s + e.actualMs, 0);
  const avgMs = sessions ? Math.round(totalMs / sessions) : 0;
  const longestMs = rows.reduce((m, e) => Math.max(m, e.actualMs), 0);
  const completed = rows.filter((e) => e.completed).length;
  const completedPct = sessions ? Math.round((100 * completed) / sessions) : 0;
  const streak = computeStreak(rows);

  const week = lastNDays(7);
  const perDay = week.map((day) => rows.filter((e) => e.day === day).reduce((s, e) => s + e.actualMs, 0));
  const max = Math.max(1, ...perDay);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">
        <Dropdown
          compact
          ariaLabel="Show stats for"
          value={filter}
          options={[{ value: "all", label: "All groups" }, ...groups.map((g) => ({ value: g.id, label: g.name }))]}
          onChange={setFilter}
        />
      </div>

      <div className="grid grid-cols-3 gap-2">
        <StatTile label="Sessions" value={`${sessions}`} />
        <StatTile label="Total" value={msToHuman(totalMs)} />
        <StatTile label="Avg" value={msToHuman(avgMs)} />
        <StatTile label="Completed" value={`${completedPct}%`} />
        <StatTile label="Streak" value={`${streak}d`} />
        <StatTile label="Longest" value={msToHuman(longestMs)} />
      </div>

      <div className="relative h-24">
        <div className="flex h-full items-end justify-between gap-1.5 pb-6">
          {week.map((day, i) => {
            const has = perDay[i] > 0;
            const height = has ? Math.max(6, Math.round((perDay[i] / max) * 60)) : 3;
            return (
              <div key={day} className="flex h-full flex-1 items-end justify-center">
                <div
                  style={{ height }}
                  className={`w-full max-w-[13px] rounded-full transition-all duration-300 ease-out ${
                    has ? "bg-line" : "bg-line/50"
                  }`}
                />
              </div>
            );
          })}
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-6 h-px bg-line/70" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-between gap-1.5">
          {week.map((day) => (
            <span key={day} className="flex-1 text-center text-[11px] text-faint">
              {dayLabel(day)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}



function computeStreak(log: FocusLogEntry[]): number {
  const days = new Set(log.map((e) => e.day));
  let streak = 0;
  const cursor = new Date();
  while (days.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

export function FocusPanel({
  focus,
  focusGroups,
  focusLog,
  onChangeGroups,
}: {
  focus: FocusSession | null;
  focusGroups: FocusGroup[];
  focusLog: FocusLogEntry[];
  onChangeGroups: (groups: FocusGroup[]) => void;
}) {
  const [page, setPage] = useState<"home" | "stats">("home");
  const [setupOpen, setSetupOpen] = useState(false);
  const [prefs, setPrefs, savePrefs] = useFocusPrefs();

  if (page === "stats") {
    return (
      <div className="flex flex-col gap-6">
        <button type="button" onClick={() => setPage("home")} className="sticky top-0 z-10 -mx-4 bg-bg px-4 py-3 text-left text-sm font-medium text-primary">
          ← Focus
        </button>
        <div>
          <h1 className="font-display text-5xl text-ink">Focus Stats</h1>
          <p className="mt-1 text-sm text-muted">Here is how your focus time adds up.</p>
        </div>
        <FocusStats log={focusLog} groups={focusGroups} />
      </div>
    );
  }

  const start = (group: FocusGroup) => {
    const next = { ...prefs, groupId: group.id };
    setSetupOpen(false);
    void savePrefs(next).then(() =>
      startSession(group, next.minutes, group.exitable, next.pomodoro ? { breakMinutes: next.breakMinutes, rounds: next.rounds } : null),
    );
  };

  return (
    <>
      <FocusHome
        focus={focus}
        groups={focusGroups}
        minutes={prefs.minutes}
        onMinutes={(minutes) => setPrefs((p) => ({ ...p, minutes }))}
        onSetup={() => setSetupOpen(true)}
        onStats={() => setPage("stats")}
      />
      {setupOpen && !focus && (
        <FocusSetupSheet
          groups={focusGroups}
          prefs={prefs}
          onPrefs={setPrefs}
          onChangeGroups={onChangeGroups}
          onStart={start}
          onClose={() => setSetupOpen(false)}
        />
      )}
    </>
  );
}
