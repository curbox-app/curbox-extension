import { browser } from "#imports";
import { useCurbox } from "../../ui/useStore";
import { UsageView, ErrorBoundary } from "../../ui/components";
import { ConsentDialog } from "../../ui/ConsentDialog";

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

function Loading() {
  return (
    <div className="relative flex h-[600px] w-[360px] flex-col items-center justify-center overflow-hidden bg-bg">
      <div className="bloom" aria-hidden="true" />
      <span className="label relative">A quiet moment…</span>
    </div>
  );
}

export function App() {
  const { usage, ready, termsAccepted, acceptTerms } = useCurbox();

  if (!ready) return <Loading />;

  if (!termsAccepted) return <ConsentDialog onAccept={() => void acceptTerms()} />;

  return (
    <div className="h-[600px] w-[360px] overflow-y-auto bg-bg">
      <ErrorBoundary>
        <UsageView usage={usage} onMenu={() => void openOptions()} />
      </ErrorBoundary>
    </div>
  );
}
