import { useState } from "react";
import type { BlockGroup, FocusGroup } from "../../lib/types";
import { newGroup } from "../../lib/types";
import { Toggle, btnOutline } from "../components";
import { GroupEditor, type ScreenBack } from "./GroupEditor";

export type { ScreenBack };

export function GroupManager({
  groups,
  focusGroups,
  onChange,
  onBack,
}: {
  groups: BlockGroup[];
  focusGroups: FocusGroup[];
  onChange: (groups: BlockGroup[]) => void;
  onBack: (back: ScreenBack | null) => void;
}) {
  // Edit a draft copy and only commit on Done, so a new group is saved exactly
  // once and cancelling leaves nothing behind.
  const [editing, setEditing] = useState<{ group: BlockGroup; isNew: boolean } | null>(null);

  const closeEditor = () => {
    setEditing(null);
    onBack(null);
  };
  const showGroup = () => onBack({ label: "Groups", go: closeEditor });

  if (editing) {
    return (
      <GroupEditor
        group={editing.group}
        focusGroups={focusGroups}
        onSave={(next) => {
          onChange(editing.isNew ? [...groups, next] : groups.map((g) => (g.id === next.id ? next : g)));
          closeEditor();
        }}
        onCancel={closeEditor}
        onBack={onBack}
        onShowGroup={showGroup}
      />
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {groups.length === 0 && <p className="text-sm text-muted py-2">No blocks yet. Add one below.</p>}
      {groups.map((group) => (
        <div key={group.id} className="flex items-center justify-between border-b border-line/70 py-3">
          <button className="-mx-2 flex-1 rounded-xl px-2 py-1 text-left transition-colors hover:bg-state" onClick={() => { setEditing({ group, isNew: false }); showGroup(); }}>
            <p className="text-sm">{group.name}</p>
            <p className="text-xs text-muted">
              {group.matchers.length} site{group.matchers.length === 1 ? "" : "s"} · {group.onEachOpen ? "On each open" : "Scheduled usage"}
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
        onClick={() => { setEditing({ group: newGroup(`New group ${groups.length + 1}`), isNew: true }); showGroup(); }}
        className={`mt-3 self-start ${btnOutline}`}
      >
        + New group
      </button>
    </div>
  );
}
