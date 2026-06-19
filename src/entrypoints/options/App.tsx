import { useEffect, useState } from "react";
import { useCurbox } from "../../ui/useStore";
import { UsageView, ErrorBoundary } from "../../ui/components";
import { GroupManager } from "../../ui/blocker";
import { FocusPanel } from "../../ui/focus";
import type { Settings } from "../../lib/types";

type Tab = "usage" | "website" | "focus";

const TABS: { value: Tab; label: string }[] = [
  { value: "usage", label: "Usage" },
  { value: "website", label: "Website Blocker" },
  { value: "focus", label: "Focus" },
];

export function App() {
  const { usage, settings, focus, focusLog, ready, saveSettings } = useCurbox();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("usage");

  useEffect(() => {
    if (ready && !draft) setDraft(settings);
  }, [ready, settings, draft]);

  if (!draft) return null;

  const commit = (next: Settings) => {
    setDraft(next);
    void saveSettings(next);
  };

  return (
    <div className="max-w-xl mx-auto px-6 py-12 flex flex-col gap-8">
      <header>
        <h1 className="font-display text-5xl">Curbox</h1>
        <p className="text-sm text-muted mt-1">I help you stay gentle with your time online.</p>
      </header>

      <nav className="flex gap-2 flex-wrap">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`rounded-full px-4 py-1.5 text-sm border ${
              tab === t.value ? "border-ink" : "border-line text-muted"
            }`}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <ErrorBoundary key={tab}>
        {tab === "usage" && <UsageView usage={usage} />}
        {tab === "website" && (
          <>
            <GroupManager groups={draft.groups} onChange={(groups) => commit({ ...draft, groups })} />
            <KeywordHelp />
          </>
        )}
        {tab === "focus" && (
          <FocusPanel
            focus={focus}
            focusGroups={draft.focusGroups}
            focusLog={focusLog}
            onChangeGroups={(focusGroups) => commit({ ...draft, focusGroups })}
          />
        )}
      </ErrorBoundary>
    </div>
  );
}

function KeywordHelp() {
  const rows: [string, string][] = [
    ["Block a whole site", "youtube.com"],
    ["Block one section", "youtube.com/shorts"],
    ["Block a path on any site", "/shorts"],
    ["Block all subdomains", "*.youtube.com"],
    ["Block by domain word", "youtube"],
    ["Advanced match", "r:shorts|reels"],
  ];
  return (
    <div className="border border-line rounded-2xl p-4 mt-6">
      <p className="text-sm mb-3">How to write keywords</p>
      <div className="flex flex-col gap-2">
        {rows.map(([what, type]) => (
          <div key={type} className="flex items-center justify-between text-xs">
            <span className="text-muted">{what}</span>
            <span className="font-mono">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
