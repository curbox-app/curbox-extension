import { browser } from "#imports";
import { useCurbox } from "../../ui/useStore";
import { UsageView, ErrorBoundary } from "../../ui/components";

async function openOptions(): Promise<void> {
  const url = browser.runtime.getURL("/options.html");
  const [existing] = await browser.tabs.query({ url });
  if (existing?.id != null) {
    await browser.tabs.update(existing.id, { active: true });
    if (existing.windowId != null) await browser.windows.update(existing.windowId, { focused: true });
  } else {
    await browser.tabs.create({ url });
  }
  window.close();
}

function TopBar() {
  return (
    <header className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-bg/90 px-5 py-3 backdrop-blur">
      <span className="flex items-center gap-1.5 text-[11px] text-faint">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/40" />
        Today
      </span>
      <button
        onClick={() => void openOptions()}
        className="flex items-center gap-1.5 rounded-pill px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-state hover:text-ink"
      >
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Settings
      </button>
    </header>
  );
}

function Loading() {
  return (
    <div className="relative flex h-[480px] w-[360px] flex-col items-center justify-center overflow-hidden bg-bg">
      <div className="bloom" aria-hidden="true" />
      <span className="label relative">A quiet moment…</span>
    </div>
  );
}

export function App() {
  const { usage, ready } = useCurbox();

  if (!ready) return <Loading />;

  return (
    <div className="min-h-[480px] w-[360px] bg-bg">
      <TopBar />
      <div className="flex flex-col gap-6 px-5 pb-6 pt-4">
        <ErrorBoundary>
          <UsageView usage={usage} />
        </ErrorBoundary>
      </div>
    </div>
  );
}
