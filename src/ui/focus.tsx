import { useEffect, useState } from "react";
import type { FocusGroup, FocusLogEntry, FocusMode, FocusSession } from "../lib/types";
import { newFocusGroup } from "../lib/types";
import { dayLabel, lastNDays, msToHuman, todayKey } from "../lib/time";
import { startSession, endSession } from "../core/focus";
import { Segmented, Slider, Toggle } from "./components";

const inputCls = "bg-transparent border-b border-line py-1 px-1 text-sm focus:outline-none focus:border-ink";

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

function timer(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = `${m}`.padStart(2, "0");
  const ss = `${s}`.padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

function ActiveSession({ focus }: { focus: FocusSession }) {
  const now = useNow(true);
  const remaining = focus.endsAt - now;
  return (
    <div className="rounded-2xl border border-line p-6 text-center">
      <p className="text-sm">I'm holding your focus right now.</p>
      <p className="font-display text-5xl mt-2">{timer(remaining)}</p>
      <p className="text-xs text-muted mt-1">{focus.name}</p>
      {focus.exitable ? (
        <button onClick={() => void endSession()} className="mt-4 text-xs text-muted underline underline-offset-2">
          End session
        </button>
      ) : (
        <p className="mt-4 text-xs text-muted">I'll stay until the timer is done.</p>
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
    <div className="rounded-2xl border border-line p-6">
      <p className="text-center font-display text-5xl">{minutes}m</p>
      <div className="mt-4">
        <Slider value={minutes} min={5} max={120} step={5} onChange={setMinutes} />
      </div>
      <select
        value={group.id}
        onChange={(e) => setGroupId(e.target.value)}
        className="mt-4 w-full bg-transparent text-sm py-1 border-b border-line focus:outline-none"
      >
        {groups.map((g) => (
          <option key={g.id} value={g.id}>
            {g.name}
          </option>
        ))}
      </select>
      <button
        onClick={() => void startSession(group, minutes, group.exitable)}
        className="mt-4 w-full rounded-full border border-ink py-2.5 text-sm"
      >
        Start focus
      </button>
    </div>
  );
}

function statTile(label: string, value: string) {
  return (
    <div className="rounded-xl border border-line p-3 text-center">
      <p className="font-display text-2xl">{value}</p>
      <p className="text-[11px] uppercase tracking-widest text-muted mt-1">{label}</p>
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
        <p className="text-xs uppercase tracking-widest text-muted">Focus stats</p>
        <select
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="bg-transparent text-xs py-1 border-b border-line focus:outline-none"
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
        {statTile("Sessions", `${sessions}`)}
        {statTile("Total", msToHuman(totalMs))}
        {statTile("Streak", `${streak}d`)}
        {statTile("Avg", msToHuman(avgMs))}
        {statTile("Completed", `${completedPct}%`)}
      </div>

      <div className="flex items-end justify-between gap-2 h-20">
        {week.map((day, i) => (
          <div key={day} className="flex flex-1 flex-col items-center gap-1">
            <div className="flex flex-1 items-end w-full justify-center">
              <div
                style={{ height: Math.max(3, Math.round((perDay[i] / max) * 64)) }}
                className="w-2.5 rounded-full bg-line"
              />
            </div>
            <span className="text-[10px] text-muted">{dayLabel(day)}</span>
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
  while (days.has(toKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function toKey(d: Date): string {
  const y = d.getFullYear();
  const m = `${d.getMonth() + 1}`.padStart(2, "0");
  const day = `${d.getDate()}`.padStart(2, "0");
  return `${y}-${m}-${day}`;
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
  const [draft, setDraft] = useState<FocusGroup>(group);
  const [entry, setEntry] = useState("");
  const patch = (p: Partial<FocusGroup>) => setDraft((d) => ({ ...d, ...p }));

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
        <p className="text-xs uppercase tracking-widest text-muted">Websites</p>
        <div className="flex gap-2">
          <input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addSite()}
            placeholder="youtube.com"
            className={`${inputCls} flex-1`}
          />
          <button onClick={addSite} className="rounded-full border border-ink px-4 text-sm">
            Add
          </button>
        </div>
        <div className="flex flex-col">
          {draft.domains.map((m) => (
            <div key={m} className="flex items-center justify-between border-b border-line py-2">
              <span className="text-sm font-mono">{m}</span>
              <button
                onClick={() => patch({ domains: draft.domains.filter((x) => x !== m) })}
                className="text-xs text-muted hover:text-ink"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-2">
        <p className="text-xs uppercase tracking-widest text-muted">Block mode</p>
        <Segmented value={draft.mode} options={MODE_OPTIONS} onChange={(mode) => patch({ mode })} />
      </div>

      <label className="flex items-center justify-between text-sm">
        Let me quit mid sessions
        <Toggle on={draft.exitable} onChange={(exitable) => patch({ exitable })} />
      </label>

      <div className="flex gap-3">
        <button
          onClick={() => onSave({ ...draft, name: draft.name.trim() || "Untitled" })}
          className="rounded-full border border-ink px-6 py-2 text-sm"
        >
          Save group
        </button>
        <button onClick={onCancel} className="text-sm text-muted">
          Cancel
        </button>
      </div>
    </div>
  );
}

function GroupManager({ groups, onChange }: { groups: FocusGroup[]; onChange: (g: FocusGroup[]) => void }) {
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
      <p className="text-xs uppercase tracking-widest text-muted">Focus groups</p>
      {groups.map((group) => (
        <div key={group.id} className="flex items-center justify-between border-b border-line py-3">
          <button className="text-left" onClick={() => setEditingId(group.id)}>
            <p className="text-sm">{group.name}</p>
            <p className="text-xs text-muted">
              {group.mode === "only-these" ? "Blocks" : "Allows only"} {group.domains.length} site
              {group.domains.length === 1 ? "" : "s"}
            </p>
          </button>
          <button
            onClick={() => onChange(groups.filter((g) => g.id !== group.id))}
            className="text-xs text-muted hover:text-ink"
          >
            Remove
          </button>
        </div>
      ))}
      <button
        onClick={() => {
          const group = newFocusGroup(`Focus ${groups.length + 1}`);
          onChange([...groups, group]);
          setEditingId(group.id);
        }}
        className="mt-2 self-start rounded-full border border-ink px-5 py-2 text-sm"
      >
        Create focus group
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
  return (
    <div className="flex flex-col gap-8">
      {focus ? <ActiveSession focus={focus} /> : <StartSession groups={focusGroups} />}
      <FocusStats log={focusLog} groups={focusGroups} />
      <GroupManager groups={focusGroups} onChange={onChangeGroups} />
    </div>
  );
}

export function FocusQuickControl({ focus, focusGroups }: { focus: FocusSession | null; focusGroups: FocusGroup[] }) {
  const now = useNow(!!focus);

  if (focus) {
    return (
      <div className="rounded-2xl border border-line p-4 text-center">
        <p className="text-xs text-muted">Focus</p>
        <p className="font-display text-3xl mt-1">{timer(focus.endsAt - now)}</p>
        {focus.exitable && (
          <button onClick={() => void endSession()} className="mt-2 text-xs text-muted underline underline-offset-2">
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
      className="rounded-2xl border border-line p-4 text-sm"
    >
      Start a 25m focus on {group.name}
    </button>
  );
}
