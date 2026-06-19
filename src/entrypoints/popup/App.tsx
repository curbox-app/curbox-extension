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

export function App() {
  const { usage, settings, focus, ready } = useCurbox();

  if (!ready) return <div className="w-[360px] h-[480px]" />;

  return (
    <div className="w-[360px] min-h-[480px] bg-bg px-5 py-6 flex flex-col gap-6">
      <ErrorBoundary>
        <UsageView usage={usage} />
        <FocusQuickControl focus={focus} focusGroups={settings.focusGroups} />
      </ErrorBoundary>
      <button onClick={() => void openOptions()} className="mt-auto text-xs text-muted self-center">
        Manage blocks and focus
      </button>
    </div>
  );
}
