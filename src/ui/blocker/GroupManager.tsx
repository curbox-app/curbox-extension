import { useState } from "react";
import type { BlockGroup, FocusGroup } from "../../lib/types";
import { newGroup } from "../../lib/types";
import { GroupList } from "../components";
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
    <GroupList
      groups={groups}
      empty="No blocks yet. Add one below."
      describe={(group) =>
        `${group.matchers.length} site${group.matchers.length === 1 ? "" : "s"} · ${group.onEachOpen ? "On each open" : "Scheduled usage"}`
      }
      onOpen={(group) => {
        setEditing({ group, isNew: false });
        showGroup();
      }}
      onChange={onChange}
      onAdd={() => {
        setEditing({ group: newGroup(`New group ${groups.length + 1}`), isNew: true });
        showGroup();
      }}
    />
  );
}
