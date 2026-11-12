import { useEffect, useRef, useState, type ReactNode } from "react";
import { browser } from "#imports";
import { get, update } from "../lib/storage";
import { countdownClock } from "../lib/time";
import { plural, usualDrop } from "../lib/urge-surf";
import type { CravingActivity, CravingSession } from "../lib/types";
import { btnOutline } from "./components";
import { QuietBlocks } from "./quiet-blocks";

type Step = "rateBefore" | "reflect" | "choose" | "puzzle" | "move" | "rateAfter" | "result";

const REFLECT_MS = 20_000;
const ACTIVITY_MS = 3 * 60_000;

const REFLECT_PROMPTS = [
  "How will you feel about this in an hour?",
  "What were you going to do instead?",
  "What would you tell a friend who felt like this?",
];

function resultMessage(before: number, after: number): string {
  const drop = before - after;
  if (drop > 0) return plural(drop, "Your craving went down by %d point.", "Your craving went down by %d points.") + " Cravings fade when you wait them out.";
  if (drop === 0) return "Your craving stayed the same, and you still did not give in. That counts.";
  return "Some cravings take longer to fade. You still rode this one out without giving in.";
}

async function closeTab(): Promise<void> {
  const tab = await browser.tabs.getCurrent().catch(() => undefined);
  if (tab?.id != null) await browser.tabs.remove(tab.id).catch(() => window.close());
  else window.close();
}

// The move step is done away from the screen, so a soft chime and a buzz say the time is up.
function chime(): void {
  try {
    navigator.vibrate?.([0, 400, 200, 400]);
    const audio = new AudioContext();
    const tone = audio.createOscillator();
    const gain = audio.createGain();
    tone.frequency.value = 528;
    gain.gain.setValueAtTime(0.0001, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.2, audio.currentTime + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + 1.6);
    tone.connect(gain).connect(audio.destination);
    tone.start();
    tone.stop(audio.currentTime + 1.7);
  } catch {
    // Sound and vibration are a courtesy.
  }
}

function useNow(running: boolean): number {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!running) return;
    const id = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(id);
  }, [running]);
  return now;
}

// The move step is usually done with the device set down.
function useWakeLock(): void {
  useEffect(() => {
    type Sentinel = { release: () => Promise<void> };
    const wakeLock = (navigator as Navigator & { wakeLock?: { request: (type: "screen") => Promise<Sentinel> } }).wakeLock;
    let sentinel: Sentinel | null = null;
    void wakeLock?.request("screen").then((s) => (sentinel = s)).catch(() => undefined);
    return () => void sentinel?.release().catch(() => undefined);
  }, []);
}

function Center({ children }: { children: ReactNode }) {
  return <div className="tab-enter flex min-h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">{children}</div>;
}

const Title = ({ children }: { children: ReactNode }) => <h1 className="font-display text-[32px] leading-tight text-ink">{children}</h1>;
const Body = ({ children }: { children: ReactNode }) => <p className="max-w-[34ch] text-base text-muted">{children}</p>;
const Clock = ({ ms, size }: { ms: number; size: string }) => (
  <p className={`tnum font-display leading-none text-primary ${size}`}>{countdownClock(ms)}</p>
);

function WavesIcon() {
  return (
    <span className="mb-3 grid h-[72px] w-[72px] place-items-center rounded-[24px] bg-secondary-chip text-primary">
      <svg viewBox="0 0 24 24" width="36" height="36" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <path d="M3 9c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0" />
        <path d="M3 14c2-1.5 3.5-1.5 5.5 0s3.5 1.5 5.5 0 3.5-1.5 5.5 0" />
      </svg>
    </span>
  );
}

function Rating({ before, onRate }: { before: boolean; onRate: (rating: number) => void }) {
  const button = (rating: number) => (
    <button
      key={rating}
      onClick={() => onRate(rating)}
      aria-label={`Rate ${rating}`}
      className="tnum h-[52px] flex-1 rounded-2xl border border-line text-base text-ink transition hover:bg-state active:scale-[0.97]"
    >
      {rating}
    </button>
  );
  return (
    <Center>
      <WavesIcon />
      <Title>{before ? "How strong is the craving?" : "How strong is it now?"}</Title>
      <Body>{before ? "Tap a number. 0 means none at all. 10 means it is all you can think about." : "Be honest. Any number is okay."}</Body>
      <div className="mt-6 flex w-full max-w-[420px] flex-col gap-2">
        <div className="flex gap-2">{[0, 1, 2, 3, 4, 5].map(button)}</div>
        <div className="flex gap-2 px-[calc((100%_+_8px)/12)]">{[6, 7, 8, 9, 10].map(button)}</div>
        <div className="flex justify-between text-xs text-faint">
          <span>None</span>
          <span>Very strong</span>
        </div>
      </div>
    </Center>
  );
}

function ActivityCard({ title, description, icon, onClick }: { title: string; description: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button onClick={onClick} className="card flex w-full items-center gap-4 p-5 text-left">
      <span className="text-primary">{icon}</span>
      <span className="flex-1">
        <b className="block text-base text-ink">{title}</b>
        <small className="text-muted">{description}</small>
      </span>
    </button>
  );
}

export function UrgeSurf() {
  useWakeLock();
  const site = new URLSearchParams(location.search).get("site") ?? "";
  const [step, setStep] = useState<Step>("rateBefore");
  const [ratingBefore, setRatingBefore] = useState(-1);
  const [ratingAfter, setRatingAfter] = useState(-1);
  const [activity, setActivity] = useState<CravingActivity>("puzzle");
  const [phaseEndsAt, setPhaseEndsAt] = useState(0);
  const [prompt] = useState(() => REFLECT_PROMPTS[Math.floor(Math.random() * REFLECT_PROMPTS.length)]);
  const [usual, setUsual] = useState(0);
  const saved = useRef(false);
  const now = useNow(step === "reflect" || step === "puzzle" || step === "move");
  const remaining = Math.max(0, phaseEndsAt - now);

  useEffect(() => {
    if ((step !== "puzzle" && step !== "move") || remaining > 0) return;
    if (step === "move") chime();
    setStep("rateAfter");
  }, [step, remaining]);

  useEffect(() => {
    if (step !== "result" || saved.current) return;
    saved.current = true;
    const session: CravingSession = { at: Date.now(), site, ratingBefore, ratingAfter, activity };
    void update("cravings", (all) => [...all, session])
      .catch(() => get("cravings"))
      .then((all) => setUsual(usualDrop(all)));
  }, [step]);

  const startActivity = (type: CravingActivity) => {
    setActivity(type);
    setPhaseEndsAt(Date.now() + ACTIVITY_MS);
    setStep(type);
  };

  return (
    <div className="relative mx-auto h-dvh max-w-[520px] overflow-y-auto bg-bg">
      {step !== "result" && (
        <button
          onClick={() => void closeTab()}
          aria-label="Close"
          className="absolute right-2 top-2 z-10 grid h-12 w-12 place-items-center rounded-full text-muted transition hover:text-ink"
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </button>
      )}

      {(step === "rateBefore" || step === "rateAfter") && (
        <Rating
          key={step}
          before={step === "rateBefore"}
          onRate={(rating) => {
            if (step === "rateBefore") {
              setRatingBefore(rating);
              setPhaseEndsAt(Date.now() + REFLECT_MS);
              setStep("reflect");
            } else {
              setRatingAfter(rating);
              setStep("result");
            }
          }}
        />
      )}

      {step === "reflect" && (
        <Center>
          <Title>{prompt}</Title>
          <Body>Take a moment to really think about it.</Body>
          <div className="mt-6 h-1 w-40 overflow-hidden rounded-full bg-line">
            <div className="h-full rounded-full bg-primary" style={{ width: `${(1 - remaining / REFLECT_MS) * 100}%` }} />
          </div>
          <button onClick={() => setStep("choose")} disabled={remaining > 0} className={`mt-4 ${btnOutline}`}>
            Continue
          </button>
        </Center>
      )}

      {step === "choose" && (
        <Center>
          <Title>Ride it out for 3 minutes</Title>
          <Body>Pick one. When the time is up, you will rate the craving again.</Body>
          <div className="mt-6 flex w-full flex-col gap-3">
            <ActivityCard
              title="Play a calm puzzle"
              description="Drag blocks onto the board. No score."
              onClick={() => startActivity("puzzle")}
              icon={
                <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor" aria-hidden="true">
                  <rect x="3" y="3" width="8" height="8" rx="2" />
                  <rect x="13" y="3" width="8" height="8" rx="2" opacity="0.55" />
                  <rect x="3" y="13" width="8" height="8" rx="2" opacity="0.55" />
                  <rect x="13" y="13" width="8" height="8" rx="2" />
                </svg>
              }
            />
            <ActivityCard
              title="Move your body"
              description="Squats, stairs, or a fast walk."
              onClick={() => startActivity("move")}
              icon={
                <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <circle cx="13" cy="4.5" r="1.8" />
                  <path d="M9 21l2.5-6 2.5 2v4M8 11l3-3.5 3.5 1.5 2 3.5M11.5 15l1.5-5.5" />
                </svg>
              }
            />
          </div>
        </Center>
      )}

      {step === "puzzle" && (
        <div className="tab-enter flex flex-col items-center gap-1 px-6 pb-6 pt-14 text-center">
          <Clock ms={remaining} size="text-[40px]" />
          <p className="mb-5 text-sm text-muted">Drag a block onto the board. Fill a row or column to clear it.</p>
          <QuietBlocks frozen={remaining <= 0} />
        </div>
      )}

      {step === "move" && (
        <Center>
          <Title>Move your body</Title>
          <Clock ms={remaining} size="mt-2 text-[64px]" />
          <p className="mt-2 whitespace-pre-line text-base leading-relaxed text-ink">
            {"Do 30 squats\nor walk up and down the stairs\nor go for a fast walk"}
          </p>
          <Body>Move hard enough that you breathe faster. A stretch does not count. This page will chime when the time is up.</Body>
        </Center>
      )}

      {step === "result" && (
        <Center>
          <p className="tnum font-display text-[72px] leading-none text-primary">
            {ratingBefore} → {ratingAfter}
          </p>
          <p className="mt-3 max-w-[34ch] text-lg text-ink">{resultMessage(ratingBefore, ratingAfter)}</p>
          {usual > 0 && (
            <Body>{plural(usual, "Your cravings usually drop by %d point in 3 minutes.", "Your cravings usually drop by %d points in 3 minutes.")}</Body>
          )}
          <button onClick={() => void closeTab()} className={`mt-6 ${btnOutline}`}>
            Close this tab
          </button>
        </Center>
      )}
    </div>
  );
}
