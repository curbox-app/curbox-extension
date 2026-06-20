import { useEffect, useState } from "react";
import { useCurbox } from "../../ui/useStore";
import { UsageView, ErrorBoundary } from "../../ui/components";
import { GroupManager } from "../../ui/blocker";
import { FocusPanel } from "../../ui/focus";
import { AboutPanel } from "../../ui/about";
import type { Settings } from "../../lib/types";

type Tab = "usage" | "website" | "focus" | "about";

const TABS: { value: Tab; label: string }[] = [
  { value: "usage", label: "Usage" },
  { value: "website", label: "Website Blocker" },
  { value: "focus", label: "Focus" },
  { value: "about", label: "About" },
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
    <div className="mx-auto flex max-w-xl flex-col gap-7 px-6 py-14">
      <header>
        <div className="flex items-center gap-2.5">
          <h1 className="font-display text-5xl leading-none">Curbox</h1>
          <span className="mt-1 h-2 w-2 animate-pulse rounded-full bg-ink/40" />
        </div>
        <p className="mt-2 text-sm text-muted">break the doomscroll</p>
      </header>

      <nav className="-mt-1 flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
            className={`relative px-4 py-3 text-sm font-medium transition-colors ${
              tab === t.value ? "text-ink" : "text-muted hover:text-ink"
            }`}
          >
            {t.label}
            {tab === t.value && <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-ink" />}
          </button>
        ))}
      </nav>

      <ErrorBoundary key={tab}>
        <div className="rise">
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
          {tab === "about" && <AboutPanel />}
        </div>
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
    <div className="card mt-6 p-5">
      <p className="label mb-3">How to write keywords</p>
      <div className="flex flex-col gap-2.5">
        {rows.map(([what, type]) => (
          <div key={type} className="flex items-center justify-between gap-3 text-xs">
            <span className="text-muted">{what}</span>
            <span className="rounded-md bg-surface-2 px-2 py-1 font-mono text-ink">{type}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
