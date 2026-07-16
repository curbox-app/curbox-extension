import { browser } from "#imports";
import { btnPrimary } from "./components";

interface Props {
  onAccept: () => void;
}

function openLink(url: string) {
  void browser.tabs.create({ url });
}

export function ConsentDialog({ onAccept }: Props) {
  return (
    <div className="relative flex min-h-[480px] w-[360px] flex-col overflow-hidden bg-bg px-6 py-8">
      <div className="bloom pointer-events-none absolute inset-0" aria-hidden="true" />

      <div className="relative flex flex-1 flex-col justify-between">
        <div>
          <h1 className="font-display text-[42px] font-bold leading-[0.9] tracking-tight text-ink">
            Before<br />we begin.
          </h1>

          <p className="mt-5 text-sm leading-relaxed text-muted">
            I track the time you spend on websites. Everything stays on your device. Nothing is shared unless you choose to sync.
          </p>

          <div className="mt-6 flex flex-col gap-0.5">
            <button
              onClick={() => openLink("https://curbox.app/terms")}
              className="group flex items-center gap-1.5 py-2 text-left text-sm font-semibold text-primary transition-opacity hover:opacity-70"
            >
              Terms of Service
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 10L10 2M10 2H5M10 2v5" />
              </svg>
            </button>
            <button
              onClick={() => openLink("https://curbox.app/privacy")}
              className="group flex items-center gap-1.5 py-2 text-left text-sm font-semibold text-primary transition-opacity hover:opacity-70"
            >
              Privacy Policy
              <svg viewBox="0 0 12 12" width="10" height="10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 10L10 2M10 2H5M10 2v5" />
              </svg>
            </button>
          </div>
        </div>

        <div className="mt-8">
          <p className="mb-3 text-[11px] leading-snug text-faint">
            By continuing, you agree to the Terms of Service and Privacy Policy.
          </p>
          <button onClick={onAccept} className={`${btnPrimary} w-full`}>
            I agree, let's start
          </button>
        </div>
      </div>
    </div>
  );
}
