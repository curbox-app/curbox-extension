import { useEffect, useState } from "react";
import { browser } from "#imports";
import type { FocusGroup, FocusLogEntry, FocusMode, FocusSession } from "../lib/types";
import { newFocusGroup } from "../lib/types";
import { dateKey, dayLabel, lastNDays, msToClock, msToHuman } from "../lib/time";
import { startSession, endSession } from "../core/focus";
import { Segmented, Toggle, btnPrimary, btnOutline, btnGhost, inputCls } from "./components";
import { useDraft } from "./useDraft";

const MODE_OPTIONS: { value: FocusMode; label: string }[] = [
  { value: "only-these", label: "Block Selected" },
  { value: "all-except", label: "Block All Except Selected" },
];

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [active]);
  return now;
}

function ActiveSession({ focus, compact }: { focus: FocusSession; compact?: boolean }) {
  const now = useNow(true);
  const remaining = focus.endsAt - now;
  const stage = compact ? "min-h-[22rem]" : "min-h-[560px]";
  return (
    <div className={`flex flex-col items-center justify-end pb-4 text-center ${stage}`}>
      <p className="text-sm text-muted">I'm holding your focus right now.</p>
      <p className="font-display tnum mt-2 text-[56px] leading-none text-ink">{msToClock(remaining)}</p>
      <p className="label mt-3">{focus.name}</p>
      {focus.exitable ? (
        <button onClick={() => void endSession()} className={`mt-8 w-full ${btnPrimary}`}>
          End session
        </button>
      ) : (
        <p className="mt-5 text-xs text-muted">I'll stay until the timer is done.</p>
      )}
    </div>
  );
}

function GroupSelector({
  groups,
  selectedId,
  onSelect,
  onEdit,
  onDelete,
  onCreate,
}: {
  groups: FocusGroup[];
  selectedId: string;
  onSelect: (id: string) => void;
  onEdit: (group: FocusGroup) => void;
  onDelete: (id: string) => void;
  onCreate: () => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = groups.find((g) => g.id === selectedId) ?? groups[0];

  return (
    <div className="relative mt-5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 rounded-2xl bg-card px-4 py-3 text-left text-sm text-ink transition-all duration-200 hover:bg-surface-2"
      >
        <span className="min-w-0 flex-1">
          <span className="block font-medium truncate">{selected?.name ?? "Select group"}</span>
          {selected && (
            <span className="block mt-0.5 text-xs text-muted">
              {selected.mode === "only-these" ? "Blocks" : "Allows only"} {selected.domains.length} site
              {selected.domains.length === 1 ? "" : "s"}
              {selected.exitable ? "" : " · locked"}
            </span>
          )}
        </span>
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={`shrink-0 text-faint transition-transform duration-200 ${open ? "rotate-180" : ""}`}>
          <path d="m6 9 6 6 6-6" />
        </svg>
      </button>

      {open && (
        <div className="rise absolute inset-x-0 top-full z-20 mt-1.5 flex flex-col rounded-2xl bg-card shadow-float overflow-hidden">
          {groups.map((g) => {
            const active = g.id === selectedId;
            return (
              <div key={g.id} className={`flex items-center gap-2 px-2 py-1 transition-colors ${active ? "bg-state" : ""}`}>
                <button
                  type="button"
                  onClick={() => { onSelect(g.id); setOpen(false); }}
                  className="min-w-0 flex-1 rounded-xl px-2 py-2 text-left transition-colors hover:bg-state"
                >
                  <span className="block truncate text-sm font-medium text-ink">{g.name}</span>
                  <span className="block mt-0.5 text-[11px] text-muted">
                    {g.mode === "only-these" ? "Blocks" : "Allows only"} {g.domains.length} site{g.domains.length === 1 ? "" : "s"}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onEdit(g); setOpen(false); }}
                  aria-label={`Edit ${g.name}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-faint transition-colors hover:bg-state hover:text-ink"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.83 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z" /><path d="m15 5 4 4" /></svg>
                </button>
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onDelete(g.id); setOpen(false); }}
                  aria-label={`Delete ${g.name}`}
                  className="grid h-8 w-8 shrink-0 place-items-center rounded-xl text-faint transition-colors hover:bg-error-container hover:text-error"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18" /><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" /><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" /></svg>
                </button>
              </div>
            );
          })}
          <button
            type="button"
            onClick={() => { onCreate(); setOpen(false); }}
            className="flex items-center gap-2 border-t border-line/70 px-4 py-3 text-sm text-primary transition-colors hover:bg-state"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
            New focus group
          </button>
        </div>
      )}
    </div>
  );
}

function StartSession({
  groups,
  onCreate,
  onEdit,
  onDelete,
  compact,
}: {
  groups: FocusGroup[];
  onCreate: () => void;
  onEdit: (group: FocusGroup) => void;
  onDelete: (id: string) => void;
  compact?: boolean;
}) {
  const stage = compact ? "min-h-[22rem]" : "min-h-[560px]";
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [minutes, setMinutes] = useState(25);

  useEffect(() => {
    void browser.storage.local.get(["ui.lastFocusDuration", "ui.lastFocusGroupId"]).then((stored) => {
      const savedMinutes = Number(stored["ui.lastFocusDuration"]);
      const savedGroup = stored["ui.lastFocusGroupId"];
      if (Number.isFinite(savedMinutes) && savedMinutes >= 1) setMinutes(Math.floor(savedMinutes));
      if (typeof savedGroup === "string" && groups.some((group) => group.id === savedGroup)) setGroupId(savedGroup);
    });
  }, []);

  const stepDown = () => setMinutes((m) => Math.max(1, m - 5));
  const stepUp = () => setMinutes((m) => m + 5);

  const durationPicker = (
    <div className="flex items-center justify-center gap-5">
      <button type="button" onClick={stepDown} className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-lg text-muted transition-colors hover:text-ink">−</button>
      <div className="flex items-baseline justify-center">
        <input type="number" aria-label="Focus duration" min={1} value={minutes} onChange={(e) => setMinutes(Math.max(1, Math.floor(Number(e.target.value)) || 1))} className="font-display tnum w-24 bg-transparent text-center text-[56px] leading-none text-ink outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
        <span className="text-xl text-muted">m</span>
      </div>
      <button type="button" onClick={stepUp} className="grid h-10 w-10 place-items-center rounded-full bg-surface-2 text-lg text-muted transition-colors hover:text-ink">+</button>
    </div>
  );

  if (groups.length === 0) {
    return (
      <div className={`flex flex-col justify-end pb-4 ${stage}`}>
        {durationPicker}
        <button onClick={onCreate} className={`mt-10 w-full ${btnPrimary}`}>Create Focus Group</button>
      </div>
    );
  }

  const group = groups.find((g) => g.id === groupId) ?? groups[0];

  return (
    <div className={`flex flex-col justify-end pb-4 ${stage}`}>
      {durationPicker}
      <GroupSelector
        groups={groups}
        selectedId={group.id}
        onSelect={setGroupId}
        onEdit={onEdit}
        onDelete={onDelete}
        onCreate={onCreate}
      />
      <button onClick={() => void browser.storage.local.set({ "ui.lastFocusDuration": minutes, "ui.lastFocusGroupId": group.id }).then(() => startSession(group, minutes, group.exitable))} className={`mt-8 w-full ${btnPrimary}`}>
        Start focus
      </button>
    </div>
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
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-transparent text-xs text-muted py-1 border-b border-line transition-colors focus:outline-none focus:border-ink"
        >
          <option value="all">All groups</option>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
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

function GroupEditor({
  group,
  onSave,
  onCancel,
}: {
  group: FocusGroup;
  onSave: (g: FocusGroup) => void;
  onCancel: () => void;
}) {
  const [draft, patch] = useDraft<FocusGroup>(group);
  const [entry, setEntry] = useState("");

  const addSite = () => {
    const clean = entry.trim().toLowerCase();
    if (!clean || draft.domains.includes(clean)) return setEntry("");
    patch({ domains: [...draft.domains, clean] });
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
        <p className="label">Websites</p>
        <div className="flex gap-2">
          <input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSite()}
            placeholder="youtube.com"
            className={`${inputCls} flex-1`}
          />
          <button onClick={addSite} className={btnOutline}>
            Add
          </button>
        </div>
        <div className="flex flex-col">
          {draft.domains.map((m) => (
            <div key={m} className="flex items-center justify-between border-b border-line/70 py-2">
              <span className="font-mono text-sm">{m}</span>
              <button
                onClick={() => patch({ domains: draft.domains.filter((x) => x !== m) })}
                className="text-xs text-faint transition-colors hover:text-ink"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="label">Block mode</p>
        <Segmented value={draft.mode} options={MODE_OPTIONS} onChange={(mode) => patch({ mode })} />
      </div>

      <label className="flex items-center justify-between text-sm">
        Let me quit mid sessions
        <Toggle on={draft.exitable} onChange={(exitable) => patch({ exitable })} />
      </label>

      <div className="flex items-center gap-4">
        <button onClick={() => onSave({ ...draft, name: draft.name.trim() || "Untitled" })} className={btnPrimary}>
          Save group
        </button>
        <button onClick={onCancel} className={btnGhost}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function FocusPanel({
  focus,
  focusGroups,
  focusLog,
  onChangeGroups,
  compact,
}: {
  focus: FocusSession | null;
  focusGroups: FocusGroup[];
  focusLog: FocusLogEntry[];
  onChangeGroups: (groups: FocusGroup[]) => void;
  compact?: boolean;
}) {
  // A group being created or edited stays a local draft until it is saved, so
  // the start-a-session card never reacts to a half-made group, and cancelling
  // leaves nothing behind.
  const [editing, setEditing] = useState<{ group: FocusGroup; isNew: boolean } | null>(null);
  const [page, setPage] = useState<"home" | "stats">("home");

  const handleCreate = () => setEditing({ group: newFocusGroup(`Focus ${focusGroups.length + 1}`), isNew: true });
  const handleEdit = (group: FocusGroup) => setEditing({ group, isNew: false });
  const handleDelete = (id: string) => onChangeGroups(focusGroups.filter((g) => g.id !== id));

  if (page === "stats") {
    return (
      <div className="flex flex-col gap-6">
        <button type="button" onClick={() => setPage("home")} className="sticky top-0 z-10 -mx-4 bg-bg px-4 py-3 text-left text-sm font-medium text-primary">
          ← Focus
        </button>
        <div>
          <h1 className="font-display text-5xl text-ink">Focus stats</h1>
          <p className="mt-1 text-sm text-muted">Here is how your focus time adds up.</p>
        </div>
        <FocusStats log={focusLog} groups={focusGroups} />
      </div>
    );
  }

  if (editing) {
    return (
      <div className="rise flex flex-col gap-5">
        <p className="label">{editing.isNew ? "New focus group" : "Edit focus group"}</p>
        <GroupEditor
          group={editing.group}
          onSave={(next) => {
            onChangeGroups(
              editing.isNew ? [...focusGroups, next] : focusGroups.map((g) => (g.id === next.id ? next : g)),
            );
            setEditing(null);
          }}
          onCancel={() => setEditing(null)}
        />
      </div>
    );
  }

  return (
    <div className="relative flex flex-col gap-8">
      <button
        type="button"
        onClick={() => setPage("stats")}
        aria-label="Focus stats"
        className="absolute right-0 top-0 z-10 grid h-9 w-9 place-items-center rounded-xl text-faint transition-colors hover:bg-state hover:text-ink"
      >
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M18 20V10" /><path d="M12 20V4" /><path d="M6 20v-6" /></svg>
      </button>
      {focus ? (
        <ActiveSession focus={focus} />
      ) : (
        <StartSession
          compact={compact}
          groups={focusGroups}
          onCreate={handleCreate}
          onEdit={handleEdit}
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}

export function FocusQuickControl({ focus, focusGroups }: { focus: FocusSession | null; focusGroups: FocusGroup[] }) {
  const now = useNow(!!focus);

  if (focus) {
    return (
      <div className="card flex items-center justify-between gap-3 p-4">
        <div>
          <p className="label">Focus</p>
          <p className="font-display tnum mt-1 text-3xl leading-none">{msToClock(focus.endsAt - now)}</p>
        </div>
        {focus.exitable && (
          <button onClick={() => void endSession()} className={btnGhost}>
            End session
          </button>
        )}
      </div>
    );
  }

  if (focusGroups.length === 0) return null;

  const group = focusGroups[0];
  return (
    <button
      onClick={() => void startSession(group, 25, group.exitable)}
      className="card flex items-center justify-between gap-3 p-4 text-left text-sm transition-all duration-200 hover:-translate-y-px hover:shadow-float"
    >
      <span>
        Start a 25m focus on <span className="font-medium">{group.name}</span>
      </span>
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-bg">→</span>
    </button>
  );
}
