import { useEffect, useState } from "react";
import { useCurbox } from "./useStore";
import { UsageView, ErrorBoundary } from "./components";
import { GroupManager, type ScreenBack } from "./blocker";
import { FocusPanel } from "./focus";
import { AboutPanel } from "./about";
import { AccountPanel } from "./account/AccountPanel";
import { ConsentDialog } from "./ConsentDialog";
import type { Settings } from "../lib/types";

type Tab = "usage" | "focus" | "reducers" | "info";
type ReducerPage = "website" | "sync" | null;

const TABS: { value: Tab; label: string }[] = [
  { value: "usage", label: "Usage" },
  { value: "focus", label: "Focus" },
  { value: "reducers", label: "Reducers" },
  { value: "info", label: "Info" },
];

function NavIcon({ tab }: { tab: Tab }) {
  if (tab === "usage") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
        <rect x="4" y="13" width="3.2" height="7" rx="1" />
        <rect x="10.4" y="8" width="3.2" height="12" rx="1" />
        <rect x="16.8" y="4" width="3.2" height="16" rx="1" />
      </svg>
    );
  }
  if (tab === "focus") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
        <circle cx="12" cy="12" r="8" />
        <path d="M12 8v4.5l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (tab === "reducers") {
    return (
      <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3.2 5 6.2v5.2c0 4.3 2.9 8.2 7 9.4 4.1-1.2 7-5.1 7-9.4V6.2L12 3.2z" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
      <circle cx="12" cy="12" r="8" />
      <path d="M12 11v5" strokeLinecap="round" />
      <circle cx="12" cy="8" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AppShell({ variant }: { variant: "popup" | "page" }) {
  const popup = variant === "popup";
  const { usage, settings, focus, focusLog, ready, termsAccepted, acceptTerms, saveSettings } = useCurbox();
  const [draft, setDraft] = useState<Settings | null>(null);
  const [tab, setTab] = useState<Tab>("usage");
  const [reducerPage, setReducerPage] = useState<ReducerPage>(null);
  const [screenBack, setScreenBack] = useState<ScreenBack | null>(null);

  useEffect(() => {
    if (ready) setDraft(settings);
  }, [ready, settings]);

  const frame = popup
    ? "flex h-full w-full flex-col overflow-hidden bg-bg"
    : "mx-auto flex h-dvh max-w-[420px] flex-col overflow-hidden bg-bg";

  if (!ready || !draft) {
    return (
      <div className={`${frame} items-center justify-center`}>
        <span className="label">A quiet moment…</span>
      </div>
    );
  }

  if (!termsAccepted) {
    return (
      <div className={`${frame} items-center justify-center`}>
        <ConsentDialog onAccept={() => void acceptTerms()} />
      </div>
    );
  }

  const commit = (next: Settings) => {
    setDraft(next);
    void saveSettings(next);
  };

  const goTab = (next: Tab) => {
    setTab(next);
    if (next !== "reducers") {
      setReducerPage(null);
      setScreenBack(null);
    }
  };

  return (
    <div className={frame}>
      <main className={`min-h-0 flex-1 overflow-y-auto pb-4 ${tab === "usage" ? "" : "px-4 pt-8"}`}>
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
                <button
                  className="sticky top-0 z-10 -mx-4 mb-4 bg-bg px-4 py-3 text-sm font-medium text-primary"
                  onClick={() => {
                    if (reducerPage === "website" && screenBack) screenBack.go();
                    else {
                      setScreenBack(null);
                      setReducerPage(null);
                    }
                  }}
                >
                  ← {reducerPage === "website" && screenBack ? screenBack.label : "Reducers"}
                </button>
                {reducerPage === "website" ? (
                  <GroupManager
                    groups={draft.groups}
                    focusGroups={draft.focusGroups}
                    onChange={(groups) => commit({ ...draft, groups })}
                    onBack={setScreenBack}
                  />
                ) : (
                  <AccountPanel />
                )}
              </>
            )}
            {tab === "info" && <AboutPanel />}
          </div>
        </ErrorBoundary>
      </main>

      <nav className="flex shrink-0 items-end justify-around bg-surface-2 px-2 pb-2 pt-1.5">
        {TABS.map((t) => {
          const on = tab === t.value;
          return (
            <button key={t.value} onClick={() => goTab(t.value)} className="flex flex-1 flex-col items-center gap-1 py-1">
              <span className={`grid h-8 w-14 place-items-center rounded-full ${on ? "bg-secondary-chip text-ink" : "text-muted"}`}>
                <NavIcon tab={t.value} />
              </span>
              <span className={`text-[12px] font-medium ${on ? "text-ink" : "text-faint"}`}>{t.label}</span>
            </button>
          );
        })}
      </nav>
    </div>
  );
}

function ReducersHome({ onOpen }: { onOpen: (page: Exclude<ReducerPage, null>) => void }) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="font-display text-5xl text-ink">Reducers</h1>
        <p className="mt-1 text-sm text-muted">Tools that make distracting browsing less rewarding.</p>
      </div>
      <p className="label">Blocker tools</p>
      <button onClick={() => onOpen("website")} className="card flex items-center gap-4 p-5 text-left">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-secondary-chip text-2xl text-on-secondary">⊘</span>
        <span className="flex-1">
          <b className="block text-base text-ink">Website Blocker</b>
          <small className="text-muted">Combine active hours, usage limits, and on-each-open pauses</small>
        </span>
        <span className="text-faint">›</span>
      </button>
      <p className="label mt-3">Across devices</p>
      <button onClick={() => onOpen("sync")} className="card flex items-center gap-4 p-5 text-left">
        <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-tertiary-chip text-2xl text-on-tertiary">↻</span>
        <span className="flex-1">
          <b className="block text-base text-ink">Sync</b>
          <small className="text-muted">Keep settings and usage in step</small>
        </span>
        <span className="text-faint">›</span>
      </button>
    </div>
  );
}
