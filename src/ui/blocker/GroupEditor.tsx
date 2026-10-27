import { useState } from "react";
import type { BlockGroup, FocusGroup } from "../../lib/types";
import { btnPrimary, btnGhost, inputCls, MatcherList } from "../components";
import { useDraft } from "../useDraft";
import { ScheduleEditor } from "./ScheduleEditor";
import { ListImporter } from "./ListImporter";
import { WarningEditor, warningSummary } from "./WarningEditor";

export type ScreenBack = { label: string; go: () => void };

export function GroupEditor({
  group,
  focusGroups,
  onSave,
  onCancel,
  onBack,
  onShowGroup,
}: {
  group: BlockGroup;
  focusGroups: FocusGroup[];
  onSave: (group: BlockGroup) => void;
  onCancel: () => void;
  onBack: (back: ScreenBack) => void;
  onShowGroup: () => void;
}) {
  const [draft, patch] = useDraft<BlockGroup>(group);
  const [page, setPage] = useState<"group" | "warning">("group");

  if (page === "warning") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="font-display text-5xl text-ink">Warning screen</h1>
          <p className="mt-1 text-sm text-muted">This is what I show when you try to get past this block.</p>
        </div>
        <WarningEditor
          warning={draft.warning}
          onChange={(warning) => patch({ warning })}
          onEachOpen={draft.onEachOpen}
          onChangeOnEachOpen={(onEachOpen) => patch({ onEachOpen, mode: onEachOpen ? "on-open" : "usage" })}
          focusGroups={focusGroups}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <input
        value={draft.name}
        onChange={(e) => patch({ name: e.target.value })}
        placeholder="Group name"
        className={`${inputCls} text-base`}
      />

      <MatcherList
        label="Websites and keywords to block"
        matchers={draft.matchers}
        onChange={(matchers) => patch({ matchers })}
      />

      <ListImporter matchers={draft.matchers} lists={draft.lists} onChange={patch} />

      <ScheduleEditor schedule={draft.schedule} onChange={(schedule) => patch({ schedule })} />

      <button
        type="button"
        onClick={() => {
          setPage("warning");
          onBack({
            label: draft.name.trim() || "Group",
            go: () => {
              setPage("group");
              onShowGroup();
            },
          });
        }}
        className="card flex items-center gap-4 p-5 text-left"
      >
        <span className="min-w-0 flex-1">
          <b className="block text-base text-ink">Warning screen</b>
          <small className="block truncate text-muted">{warningSummary(draft.warning, draft.onEachOpen)}</small>
        </span>
        <span className="text-faint">›</span>
      </button>

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
