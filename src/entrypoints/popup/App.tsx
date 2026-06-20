import { browser } from "#imports";
import { useCurbox } from "../../ui/useStore";
import { UsageView, ErrorBoundary } from "../../ui/components";
import { FocusQuickControl } from "../../ui/focus";

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

function Header() {
  return (
    <header className="flex items-center justify-between">
      <h1 className="font-display text-2xl leading-none tracking-tight">Curbox</h1>
      <span className="flex items-center gap-1.5 text-[11px] text-faint">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-ink/40" />
        Today
      </span>
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
  const { usage, settings, focus, ready } = useCurbox();

  if (!ready) return <Loading />;

  return (
    <div className="flex min-h-[480px] w-[360px] flex-col gap-6 bg-bg px-5 py-6">
      <Header />
      <ErrorBoundary>
        <UsageView usage={usage} />
        <FocusQuickControl focus={focus} focusGroups={settings.focusGroups} />
      </ErrorBoundary>
      <button
        onClick={() => void openOptions()}
        className="mt-auto flex items-center justify-center gap-1.5 rounded-pill py-2.5 text-xs font-medium text-muted transition-colors hover:bg-state hover:text-ink"
      >
        Manage blocks and focus →
      </button>
    </div>
  );
}
