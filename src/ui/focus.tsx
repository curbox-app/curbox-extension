import { useEffect, useState } from "react";
import type { FocusGroup, FocusLogEntry, FocusMode, FocusSession } from "../lib/types";
import { newFocusGroup } from "../lib/types";
import { dateKey, dayLabel, lastNDays, msToClock, msToHuman } from "../lib/time";
import { startSession, endSession } from "../core/focus";
import { Segmented, Slider, Toggle, btnPrimary, btnOutline, btnGhost, inputCls, selectCls } from "./components";
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

function ActiveSession({ focus }: { focus: FocusSession }) {
  const now = useNow(true);
  const remaining = focus.endsAt - now;
  return (
    <div className="card relative flex flex-col items-center overflow-hidden p-7 text-center">
      <div className="bloom" aria-hidden="true" />
      <p className="relative text-sm text-muted">I'm holding your focus right now.</p>
      <p className="font-display tnum relative mt-2 text-[56px] leading-none">{msToClock(remaining)}</p>
      <p className="label relative mt-2">{focus.name}</p>
      {focus.exitable ? (
        <button onClick={() => void endSession()} className={`relative mt-5 ${btnGhost}`}>
          End session
        </button>
      ) : (
        <p className="relative mt-5 text-xs text-muted">I'll stay until the timer is done.</p>
      )}
    </div>
  );
}

function StartSession({ groups }: { groups: FocusGroup[] }) {
  const [groupId, setGroupId] = useState(groups[0]?.id ?? "");
  const [minutes, setMinutes] = useState(25);

  if (groups.length === 0) {
    return <p className="text-sm text-muted py-2">Make a focus group below to begin a session.</p>;
  }

  const group = groups.find((g) => g.id === groupId) ?? groups[0];

  return (
    <div className="card p-7">
      <div className="text-center">
        <span className="font-display tnum text-[64px] leading-none">{minutes}</span>
        <span className="font-display ml-1 text-2xl text-muted">min</span>
      </div>
      <div className="mt-5">
        <Slider value={minutes} min={5} max={120} step={5} onChange={setMinutes} />
      </div>
      <select value={group.id} onChange={(e) => setGroupId(e.target.value)} className={`mt-5 ${selectCls}`}>
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button onClick={() => void startSession(group, minutes, group.exitable)} className={`mt-6 w-full ${btnPrimary}`}>
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
  const completed = rows.filter((e) => e.completed).length;
  const completedPct = sessions ? Math.round((100 * completed) / sessions) : 0;
  const streak = computeStreak(rows);

  const week = lastNDays(7);
  const perDay = week.map((day) => rows.filter((e) => e.day === day).reduce((s, e) => s + e.actualMs, 0));
  const max = Math.max(1, ...perDay);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <p className="label">Focus stats</p>
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
        <StatTile label="Streak" value={`${streak}d`} />
        <StatTile label="Avg" value={msToHuman(avgMs)} />
        <StatTile label="Completed" value={`${completedPct}%`} />
      </div>

      <div className="flex items-end justify-between gap-2 h-20">
        {week.map((day, i) => (
          <div key={day} className="flex flex-1 flex-col items-center gap-1.5">
            <div className="flex flex-1 items-end w-full justify-center">
              <div
                style={{ height: Math.max(3, Math.round((perDay[i] / max) * 60)) }}
                className="w-full max-w-[10px] rounded-full bg-line transition-all duration-300"
              />
            </div>
            <span className="text-[10px] text-faint">{dayLabel(day)}</span>
          </div>
        ))}
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

function GroupList({
  groups,
  onEdit,
  onCreate,
  onRemove,
}: {
  groups: FocusGroup[];
  onEdit: (group: FocusGroup) => void;
  onCreate: () => void;
  onRemove: (id: string) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <p className="label mb-1">Focus groups</p>
      {groups.map((group) => (
        <div key={group.id} className="flex items-center justify-between border-b border-line/70 py-3">
          <button className="-mx-2 flex-1 rounded-xl px-2 py-1 text-left transition-colors hover:bg-state" onClick={() => onEdit(group)}>
            <p className="text-sm">{group.name}</p>
            <p className="text-xs text-muted">
              {group.mode === "only-these" ? "Blocks" : "Allows only"} {group.domains.length} site
              {group.domains.length === 1 ? "" : "s"}
            </p>
          </button>
          <button onClick={() => onRemove(group.id)} className="text-xs text-faint transition-colors hover:text-ink">
            Remove
          </button>
        </div>
      ))}
      <button onClick={onCreate} className={`mt-3 self-start ${btnOutline}`}>
        + Create focus group
      </button>
    </div>
  );
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
  // A group being created or edited stays a local draft until it is saved, so
  // the start-a-session card never reacts to a half-made group, and cancelling
  // leaves nothing behind.
  const [editing, setEditing] = useState<{ group: FocusGroup; isNew: boolean } | null>(null);

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
    <div className="flex flex-col gap-8">
      {focus ? <ActiveSession focus={focus} /> : <StartSession groups={focusGroups} />}
      <FocusStats log={focusLog} groups={focusGroups} />
      <GroupList
        groups={focusGroups}
        onEdit={(group) => setEditing({ group, isNew: false })}
        onCreate={() => setEditing({ group: newFocusGroup(`Focus ${focusGroups.length + 1}`), isNew: true })}
        onRemove={(id) => onChangeGroups(focusGroups.filter((g) => g.id !== id))}
      />
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
