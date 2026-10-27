import { useEffect, useState, type ReactNode } from "react";
import { browser } from "#imports";
import { newGroup, type BlockGroup } from "../lib/types";
import { btnGhost, btnPrimary, inputCls } from "./components";

// Mirrors Android OnboardingFragment and its screens (Empathy, ScreenTimeEstimate,
// CoreValues, TargetSelection), with the same words, art and order. Android's
// permissions step asks for phone system access, which a browser does not need.

const TERMS_URL = "https://curbox.app/terms.html";
const PRIVACY_URL = "https://curbox.app/privacy.html";

type AsciiModule = typeof import("../lib/ascii");
const asciiModule = import("../lib/ascii");

function useAscii(name: string): string {
  const [art, setArt] = useState("");
  useEffect(() => {
    let alive = true;
    void asciiModule.then((m: AsciiModule) => alive && setArt(m.ASCII_ART[name] ?? ""));
    return () => {
      alive = false;
    };
  }, [name]);
  return art;
}

function Step({ art, artSize, children }: { art: string; artSize: number; children: ReactNode }) {
  const ascii = useAscii(art);
  return (
    <div className="onboard-enter flex min-h-full flex-col">
      <div className="shrink-0 overflow-x-auto overflow-y-hidden [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-hidden="true">
        <pre className="m-0 w-max select-none whitespace-pre font-mono leading-[1.15] text-ink opacity-50" style={{ fontSize: artSize }}>
          {ascii}
        </pre>
      </div>
      <div className="flex flex-1 flex-col justify-center gap-6 px-6 py-8">{children}</div>
    </div>
  );
}

const Title = ({ children }: { children: ReactNode }) => (
  <h1 className="font-display text-[55px] font-bold leading-[0.95] tracking-tight text-ink">{children}</h1>
);

function Chips<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; label: string }[]; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
      {options.map((option) => {
        const on = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(option.value)}
            className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm transition-colors ${
              on ? "border-transparent bg-secondary-chip text-on-secondary" : "border-line text-ink hover:bg-state"
            }`}
          >
            {on && (
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M5 12.5 10 17 19 7" />
              </svg>
            )}
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

const TARGETS = [
  { value: "Instagram", label: "Instagram", domain: "instagram.com" },
  { value: "TikTok", label: "TikTok", domain: "tiktok.com" },
  { value: "YouTube", label: "YouTube", domain: "youtube.com" },
  { value: "Reddit", label: "Reddit", domain: "reddit.com" },
  { value: "Other", label: "Other (Select later)", domain: "" },
];

const LIMITS = [
  { value: "15", label: "15 min" },
  { value: "30", label: "30 min" },
  { value: "60", label: "1 hour" },
  { value: "120", label: "2 hours" },
];

// Android's createStarterGroup: the picked site, limited for the whole day.
function starterGroup(target: string, limitMinutes: number): BlockGroup | null {
  const domain = TARGETS.find((t) => t.value === target)?.domain;
  if (!domain) return null;
  const group = newGroup(`${target} Limits`);
  group.matchers = [domain];
  group.schedule.days = group.schedule.days.map((day) => ({ ...day, active: true, limitMinutes, ranges: [{ start: 0, end: 1440 }] }));
  return group;
}

export function Onboarding({
  termsAccepted,
  onAcceptTerms,
  onFinish,
}: {
  termsAccepted: boolean;
  onAcceptTerms: () => void;
  onFinish: (group: BlockGroup | null) => void;
}) {
  const [step, setStep] = useState(0);
  const [hours, setHours] = useState(4);
  const [goals, setGoals] = useState("I would rather spend this time ...");
  const [target, setTarget] = useState("Instagram");
  const [limit, setLimit] = useState("30");
  const next = () => setStep((s) => s + 1);
  const weeks = Math.floor(Math.floor((hours * 365) / 24) / 7);

  return (
    <div className="relative h-full overflow-y-auto bg-surface">
      {step === 0 && (
        <Step key="empathy" art="brain" artSize={11}>
          <Title>Your phone is designed to be addictive</Title>
          <p className="text-base leading-relaxed text-muted">
            You aren’t lazy, and your willpower isn't broken. You're just fighting algorithms built by thousands of psychologists to keep you scrolling.
          </p>
          <button type="button" onClick={next} className={`${btnPrimary} self-start`}>
            Reduce the load on my willpower.
          </button>
        </Step>
      )}

      {step === 1 && (
        <Step key="estimate" art="pill" artSize={9}>
          <Title>How much do you scroll a day?</Title>
          <p className="font-display tnum text-2xl font-bold text-ink">{hours} hrs</p>
          <input
            type="range"
            min={1}
            max={16}
            step={1}
            value={hours}
            aria-label="Hours a day"
            onChange={(e) => setHours(Number(e.target.value))}
            className="h-8 w-full cursor-pointer accent-[var(--primary)]"
          />
          <p className="text-xl font-bold leading-snug text-ink">That is {weeks} full weeks of your life staring at a screen per year.</p>
          <button type="button" onClick={next} className={`${btnPrimary} self-start`}>
            I want my time back.
          </button>
        </Step>
      )}

      {step === 2 && (
        <Step key="values" art="meditate" artSize={12}>
          <Title>What are you making room for?</Title>
          <textarea value={goals} onChange={(e) => setGoals(e.target.value)} rows={2} aria-label="What you are making room for" className={`${inputCls} resize-none text-base`} />
          <button type="button" onClick={next} className={`${btnPrimary} self-start`}>
            Commit to these goals.
          </button>
        </Step>
      )}

      {step === 3 && (
        <Step key="target" art="aim" artSize={6}>
          <Title>Choose your first target.</Title>
          <Chips label="First target" value={target} options={TARGETS} onChange={setTarget} />
          <p className="text-base font-medium text-ink">Daily Limit</p>
          <Chips label="Daily Limit" value={limit} options={LIMITS} onChange={setLimit} />
          <div className="flex flex-col items-start gap-1">
            <button type="button" onClick={() => onFinish(starterGroup(target, Number(limit)))} className={btnPrimary}>
              Add friction to this app
            </button>
            <button type="button" onClick={() => onFinish(null)} className={btnGhost}>
              I'll pick this later
            </button>
          </div>
        </Step>
      )}

      {!termsAccepted && <TermsConsent onAccept={onAcceptTerms} />}
    </div>
  );
}

// Android closes the app on "Not now". Here that means closing this window or tab.
function leave(): void {
  void browser.tabs
    .getCurrent()
    .then((tab) => (tab?.id != null ? browser.tabs.remove(tab.id) : window.close()))
    .catch(() => window.close());
}

// Android's dialog_terms_consent: a dialog that cannot be dismissed, shown over
// the first onboarding screen.
function TermsConsent({ onAccept }: { onAccept: () => void }) {
  const [reading, setReading] = useState<{ title: string; url: string } | null>(null);

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/60 p-6">
      <div role="dialog" aria-modal="true" aria-labelledby="terms-title" className="rise flex max-h-full w-full max-w-[400px] flex-col overflow-hidden rounded-[28px] bg-card shadow-float">
        <div className="overflow-y-auto px-6 pb-2 pt-6">
          <h2 id="terms-title" className="text-[30px] font-bold leading-tight text-ink">
            One quick thing
          </h2>
          <p className="mt-4 text-base leading-[1.5] text-muted">Before you start, please read our Terms and Conditions and Privacy Policy.</p>
          <div className="mt-6 flex flex-col">
            <button type="button" onClick={() => setReading({ title: "Terms and Conditions", url: TERMS_URL })} className="-mx-2 rounded-lg px-2 py-2 text-left text-base font-bold text-primary transition-colors hover:bg-state">
              Read the Terms and Conditions
            </button>
            <button type="button" onClick={() => setReading({ title: "Privacy Policy", url: PRIVACY_URL })} className="-mx-2 rounded-lg px-2 py-2 text-left text-base font-bold text-primary transition-colors hover:bg-state">
              Read the Privacy Policy
            </button>
          </div>
          <p className="mt-5 text-sm text-muted">Tapping "I agree" means you accept both.</p>
        </div>
        <div className="flex justify-end gap-2 px-4 pb-4 pt-4">
          <button type="button" onClick={leave} className="rounded-full px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-state">
            Not now
          </button>
          <button type="button" onClick={onAccept} className="rounded-full px-4 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-state">
            I agree
          </button>
        </div>
      </div>
      {reading && <DocumentViewer {...reading} onClose={() => setReading(null)} />}
    </div>
  );
}

// Shows the page inside the extension, since opening a new tab from here does
// not always work in mobile browsers. A plain link remains as a fallback.
export function DocumentViewer({ title, url, onClose }: { title: string; url: string; onClose: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div role="dialog" aria-modal="true" aria-label={title} className="fixed inset-0 z-50 flex flex-col bg-surface">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
        <p className="truncate text-base font-semibold text-ink">{title}</p>
        <button type="button" onClick={onClose} className="rounded-full px-3 py-1.5 text-sm font-medium text-primary transition-colors hover:bg-state">
          Close
        </button>
      </div>
      <div className="relative min-h-0 flex-1 bg-white">
        {offline ? (
          <p className="p-6 text-sm text-neutral-700">This page needs an internet connection. Check your connection and try again, or open it in your browser below.</p>
        ) : (
          <>
            {!loaded && <p className="absolute inset-x-0 top-8 text-center text-sm text-neutral-500">Loading…</p>}
            <iframe
              src={url}
              title={title}
              onLoad={() => setLoaded(true)}
              sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
              referrerPolicy="no-referrer"
              className={`h-full w-full border-0 transition-opacity duration-300 ${loaded ? "opacity-100" : "opacity-0"}`}
            />
          </>
        )}
      </div>
      <div className="shrink-0 border-t border-line px-4 py-3 text-center">
        <a href={url} target="_blank" rel="noreferrer noopener" className="text-sm font-medium text-primary">
          Open in browser
        </a>
      </div>
    </div>
  );
}
