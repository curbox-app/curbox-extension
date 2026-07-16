import { useEffect, useState } from "react";
import { useCurbox } from "../../ui/useStore";
import { UsageView, ErrorBoundary } from "../../ui/components";
import { GroupManager } from "../../ui/blocker";
import { FocusPanel } from "../../ui/focus";
import { AboutPanel } from "../../ui/about";
import { AccountPanel } from "../../ui/account/AccountPanel";
import { ConsentDialog } from "../../ui/ConsentDialog";
import type { Settings } from "../../lib/types";

type Tab = "usage" | "focus" | "reducers" | "info";
type ReducerPage = "website" | "sync" | null;

const TABS: { value: Tab; label: string }[] = [
  { value: "usage", label: "Usage" },
  { value: "focus", label: "Focus" },
  { value: "reducers", label: "Reducers" },
  { value: "info", label: "Info" },
];

export function App() {
  const { usage, settings, focus, focusLog, ready, termsAccepted, acceptTerms, saveSettings } = useCurbox();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("usage");
  const [reducerPage, setReducerPage] = useState<ReducerPage>(null);

  useEffect(() => {
    if (ready && !draft) setDraft(settings);
  }, [ready, settings, draft]);

  if (!ready || !draft) return null;

  if (!termsAccepted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-bg">
        <ConsentDialog onAccept={() => void acceptTerms()} />
      </div>
    );
  }

  const commit = (next: Settings) => {
    setDraft(next);
    void saveSettings(next);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col bg-bg">
      <main className="flex-1 px-6 pb-28 pt-10">
      <ErrorBoundary key={`${tab}:${reducerPage}`}>
        <div className="tab-enter">
          {tab === "usage" && <UsageView usage={usage} />}
          {tab === "focus" && (
            <FocusPanel
              focus={focus}
              focusGroups={draft.focusGroups}
              focusLog={focusLog}
              onChangeGroups={(focusGroups) => commit({ ...draft, focusGroups })}
            />
          )}
          {tab === "reducers" && reducerPage === null && <ReducersHome onOpen={setReducerPage} />}
          {tab === "reducers" && reducerPage !== null && (
            <>
              <button className="mb-5 text-sm font-medium text-primary" onClick={() => setReducerPage(null)}>← Reducers</button>
              {reducerPage === "website" ? (
                <>
                  <GroupManager groups={draft.groups} onChange={(groups) => commit({ ...draft, groups })} />
                  <KeywordHelp />
                </>
              ) : <AccountPanel />}
            </>
          )}
          {tab === "info" && <AboutPanel />}
        </div>
      </ErrorBoundary>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-xl items-stretch justify-around border-t border-line bg-card pb-1 pt-2">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => { setTab(t.value); if (t.value !== "reducers") setReducerPage(null); }}
            className="flex flex-1 flex-col items-center gap-1 py-1 text-[11px] font-medium"
          >
            <span className={`flex h-8 w-16 items-center justify-center rounded-full text-lg ${tab === t.value ? "bg-secondary-chip text-on-secondary" : "text-faint"}`}>
              {t.value === "usage" ? "▥" : t.value === "focus" ? "◷" : t.value === "reducers" ? "◒" : "ⓘ"}
            </span>
            <span className={tab === t.value ? "text-ink" : "text-faint"}>{t.label}</span>
          </button>
        ))}
      </nav>
    </div>
  );
}

function ReducersHome({ onOpen }: { onOpen: (page: Exclude<ReducerPage, null>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div><h1 className="font-display text-5xl text-ink">Reducers</h1><p className="mt-1 text-sm text-muted">Tools that make distracting browsing less rewarding.</p></div>
      <p className="label">Blocker tools</p>
      <button onClick={() => onOpen("website")} className="card flex items-center gap-4 p-5 text-left">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary-chip text-2xl text-on-secondary">⊘</span>
        <span className="flex-1"><b className="block text-base text-ink">Website Blocker</b><small className="text-muted">Block sites by time, usage, or on each open</small></span><span className="text-faint">›</span>
      </button>
      <p className="label mt-3">Across devices</p>
      <button onClick={() => onOpen("sync")} className="card flex items-center gap-4 p-5 text-left">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tertiary-chip text-2xl text-on-tertiary">↻</span>
        <span className="flex-1"><b className="block text-base text-ink">Sync</b><small className="text-muted">Keep settings and usage in step</small></span><span className="text-faint">›</span>
      </button>
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
