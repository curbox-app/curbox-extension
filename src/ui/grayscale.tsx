import { useState } from "react";
import type { GrayscaleGroup } from "../lib/types";
import { newGrayscaleGroup } from "../lib/types";
import { GroupList, MatcherList, btnGhost, btnPrimary, inputCls } from "./components";
import { ScheduleEditor, hoursSummary, type ScreenBack } from "./blocker";
import { useDraft } from "./useDraft";

function GrayscaleEditor({
  group,
  onSave,
  onCancel,
}: {
  group: GrayscaleGroup;
  onSave: (group: GrayscaleGroup) => void;
  onCancel: () => void;
}) {
  const [draft, patch] = useDraft<GrayscaleGroup>(group);
  return (
    <div className="flex flex-col gap-5">
      <input
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="Group name"
        className={`${inputCls} text-base`}
      />
      <MatcherList label="Sites to turn gray" matchers={draft.sites} onChange={(sites) => patch({ sites })} />
      <ScheduleEditor schedule={draft.schedule} onChange={(schedule) => patch({ schedule })} showLimit={false} />
      <div className="flex items-center gap-4">
        <button onClick={() => onSave({ ...draft, name: draft.name.trim() || "Untitled" })} className={btnPrimary}>
          Done
        </button>
        <button onClick={onCancel} className={btnGhost}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export function GrayscalePanel({
  groups,
  onChange,
  onBack,
}: {
  groups: GrayscaleGroup[];
  onChange: (groups: GrayscaleGroup[]) => void;
  onBack: (back: ScreenBack | null) => void;
}) {
  const [editing, setEditing] = useState<{ group: GrayscaleGroup; isNew: boolean } | null>(null);

  const open = (group: GrayscaleGroup, isNew: boolean) => {
    setEditing({ group, isNew });
    onBack({ label: "Grayscale", go: close });
  };
  const close = () => {
    setEditing(null);
    onBack(null);
  };

  if (editing) {
    return (
      <GrayscaleEditor
        group={editing.group}
        onSave={(next) => {
          onChange(editing.isNew ? [...groups, next] : groups.map((g) => (g.id === next.id ? next : g)));
          close();
        }}
        onCancel={close}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-5xl text-ink">Grayscale</h1>
        <p className="mt-1 text-sm text-muted">I drain the color from the sites you pick, so they feel a little less exciting.</p>
      </div>
      <GroupList
        groups={groups}
        empty="No grayscale groups yet. Make one below."
        describe={(group) =>
          `${group.sites.length} site${group.sites.length === 1 ? "" : "s"} · ${hoursSummary(group.schedule)}`
        }
        onOpen={(group) => open(group, false)}
        onChange={onChange}
        onAdd={() => open(newGrayscaleGroup(`Gray group ${groups.length + 1}`), true)}
      />
    </div>
  );
}
