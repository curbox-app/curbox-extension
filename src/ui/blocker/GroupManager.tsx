import { useState } from "react";
import type { BlockGroup } from "../../lib/types";
import { newGroup } from "../../lib/types";
import { Toggle, btnOutline } from "../components";
import { MODE_LABEL } from "./constants";
import { GroupEditor } from "./GroupEditor";

export function GroupManager({ groups, onChange }: { groups: BlockGroup[]; onChange: (groups: BlockGroup[]) => void }) {
  // Edit a draft copy and only commit on Done, so a new group is saved exactly
  // once and cancelling leaves nothing behind.
  const [editing, setEditing] = useState<{ group: BlockGroup; isNew: boolean } | null>(null);

  if (editing) {
    return (
      <GroupEditor
        group={editing.group}
        onSave={(next) => {
          onChange(editing.isNew ? [...groups, next] : groups.map((g) => (g.id === next.id ? next : g)));
          setEditing(null);
        }}
        onCancel={() => setEditing(null)}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.length === 0 && <p className="text-sm text-muted py-2">No blocks yet. Add one below.</p>}
      {groups.map((group) => (
        <div key={group.id} className="flex items-center justify-between border-b border-line/70 py-3">
          <button className="-mx-2 flex-1 rounded-xl px-2 py-1 text-left transition-colors hover:bg-state" onClick={() => setEditing({ group, isNew: false })}>
            <p className="text-sm">{group.name}</p>
            <p className="text-xs text-muted">
              {group.matchers.length} site{group.matchers.length === 1 ? "" : "s"} · {MODE_LABEL[group.mode]}
            </p>
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
      <button
        onClick={() => setEditing({ group: newGroup(`New group ${groups.length + 1}`), isNew: true })}
        className={`mt-3 self-start ${btnOutline}`}
      >
        + New group
      </button>
    </div>
  );
}
