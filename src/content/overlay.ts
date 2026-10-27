import type { BlockDecision, WarningScreen } from "../lib/types";
import { AdaptiveMathChallenge } from "../core/adaptive-math";
import { lockScroll } from "./dom";

const STYLE = `
:host { all: initial; }
.curbox-root {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  overflow-y: auto;
  overscroll-behavior: contain;
  -webkit-tap-highlight-color: transparent;
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #0f1115;
  color: #f3f4f8;
  opacity: 0;
  transition: opacity 0.6s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.curbox-root.visible { opacity: 1; }
.card:focus { outline: none; }
.card {
  margin: auto;
  width: min(460px, 86vw);
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  gap: 26px;
  padding: 8px;
}
@media (prefers-reduced-motion: reduce) {
  .curbox-root { transition: none; }
}
.message {
  font-size: 21px;
  line-height: 1.5;
  margin: 0;
  max-width: 38ch;
  white-space: pre-line;
}
.body { display: flex; flex-direction: column; gap: 14px; width: 100%; align-items: center; }
.sentence { font-style: italic; font-size: 15px; opacity: 0.7; max-width: 36ch; margin: 0; }
.problem { font-size: 24px; margin: 0; font-variant-numeric: tabular-nums; }
.note { font-size: 14px; opacity: 0.6; margin: 0; }
input, textarea {
  font-family: inherit;
  font-size: 16px;
  box-sizing: border-box;
  width: 100%;
  max-width: 340px;
  background: transparent;
  border: 1px solid rgba(243, 244, 248, 0.22);
  border-radius: 14px;
  padding: 11px 14px;
  color: inherit;
  outline: none;
}
button {
  font-family: inherit;
  font-size: 15px;
  cursor: pointer;
  border-radius: 999px;
  padding: 13px 28px;
  transition: opacity 0.3s ease;
}
.primary {
  border: 1px solid currentColor;
  background: transparent;
  color: inherit;
  min-width: 220px;
}
.primary:disabled { opacity: 0.4; cursor: default; }
.actions { display: flex; flex-direction: column; align-items: center; gap: 6px; margin-top: 6px; }
.secondary { border: none; background: transparent; color: inherit; opacity: 0.7; }
.secondary:hover { opacity: 1; }
.error { color: #ffb4ab; opacity: 1; }
.minutes { display: flex; align-items: center; justify-content: center; gap: 10px; font-size: 15px; }
.minutes input { width: 96px; text-align: center; }

`;

function makeButton(label: string, onClick: () => void, className = "primary"): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = className;
  button.textContent = label;
  button.onclick = onClick;
  return button;
}

// Phone keyboards capitalize, autocorrect and add spaces on their own, which
// would make typed answers fail to match.
function makeInput<K extends "input" | "textarea">(tag: K, placeholder: string): HTMLElementTagNameMap[K] {
  const input = document.createElement(tag);
  input.placeholder = placeholder;
  input.spellcheck = false;
  for (const [name, value] of [["autocomplete", "off"], ["autocapitalize", "off"], ["autocorrect", "off"]]) {
    input.setAttribute(name, value);
  }
  return input;
}

function makeNote(text: string): HTMLParagraphElement {
  const note = document.createElement("p");
  note.className = "note";
  note.textContent = text;
  return note;
}

export interface OverlayHandlers {
  onProceed: (minutes?: number) => void;
  onLeave: () => void;
  onEndFocus: () => void;
}

export interface Overlay {
  show: (decision: BlockDecision, handlers: OverlayHandlers) => void;
  hide: () => void;
}

export function createOverlay(): Overlay {
  let host: HTMLDivElement | null = null;
  // Signature of the decision currently on screen. The background re-sends the
  // same "evaluate" on every tick and focus change; without this we would tear
  // the overlay down and rebuild it each time, replaying the fade and dropping
  // any in-progress countdown or typed input. Identical decision => leave it be.
  let shownKey: string | null = null;
  const timers = new Set<ReturnType<typeof setInterval>>();

  // A blocked video must not keep playing behind the pause, or start again
  // when the page autoplays the next one.
  const stopMedia = (event: Event) => {
    if (event.target instanceof HTMLMediaElement) event.target.pause();
  };

  function mount(): ShadowRoot {
    host = document.createElement("div");
    host.id = "curbox-overlay-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    shadow.appendChild(style);
    (document.documentElement || document.body).appendChild(host);
    return shadow;
  }

  function countdown(seconds: number, onTick: (left: number) => void, onDone: () => void): void {
    let left = seconds;
    onTick(left);
    if (left <= 0) {
      onDone();
      return;
    }
    const id = setInterval(() => {
      left -= 1;
      onTick(left);
      if (left <= 0) {
        clearInterval(id);
        timers.delete(id);
        onDone();
      }
    }, 1000);
    timers.add(id);
  }

  function show(decision: BlockDecision, handlers: OverlayHandlers) {
    const key = JSON.stringify(decision);
    if (host && shownKey === key) return;
    if (host) hide();
    shownKey = key;
    const shadow = mount();
    lockScroll(true);
    document.querySelectorAll("video, audio").forEach((media) => (media as HTMLMediaElement).pause());
    document.addEventListener("play", stopMedia, true);

    const root = document.createElement("div");
    root.className = "curbox-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "A mindful pause from Curbox");
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = -1;
    const message = document.createElement("p");
    message.className = "message";
    message.textContent = decision.message;
    const body = document.createElement("div");
    body.className = "body";
    card.append(message, body);
    root.appendChild(card);
    shadow.appendChild(root);
    requestAnimationFrame(() => root.classList.add("visible"));
    card.focus();
    trapFocus(root, shadow, handlers.onLeave);

    if (decision.source === "focus") {
      renderFocus(body, decision, handlers);
      return;
    }
    renderWarning(body, decision, handlers);
  }

  function renderFocus(body: HTMLDivElement, decision: BlockDecision, handlers: OverlayHandlers): void {
    if (decision.focusExitable) {
      body.appendChild(
        makeButton("End focus session", () => {
          handlers.onEndFocus();
          hide();
        }),
      );
    } else {
      body.appendChild(makeNote("I'll stay until the timer is done."));
    }
  }

  // Follows Android WarningActivity: opens left, a wait before the challenge,
  // then Proceed and Cancel. When there is no way through, only Okay remains.
  function renderWarning(body: HTMLDivElement, decision: BlockDecision, handlers: OverlayHandlers): void {
    const warning = decision.warning;
    const actions = document.createElement("div");
    actions.className = "actions";

    if (!decision.canProceed || !warning) {
      if (decision.focusGoalRemainingMs > 0) {
        const minutes = Math.ceil(decision.focusGoalRemainingMs / 60_000);
        body.appendChild(makeNote(`Focus goal not met. ${minutes} minutes remaining for ${decision.focusGoalGroupName || "the selected focus group"}.`));
      } else if (decision.proceedRetryMinutes > 0 && warning) {
        body.appendChild(
          makeNote(
            `Proceed limit of ${warning.proceedLimit} per ${warning.proceedWindowMinutes} minutes has been reached. Try again in ${decision.proceedRetryMinutes} minutes.`,
          ),
        );
      }
      actions.appendChild(makeButton("Okay", handlers.onLeave));
      body.appendChild(actions);
      return;
    }

    if (decision.proceedsLeft >= 0) {
      body.appendChild(makeNote(`You have ${decision.proceedsLeft} of ${warning.proceedLimit} opens left`));
    }
    const slot = document.createElement("div");
    slot.className = "body";
    const proceedButton = makeButton("Proceed", () => {});
    proceedButton.disabled = true;
    actions.append(proceedButton, makeButton("Cancel", handlers.onLeave, "secondary"));
    body.append(slot, actions);

    const proceed = (minutes?: number) => {
      handlers.onProceed(minutes);
      hide();
    };
    const wait = makeNote("");
    slot.appendChild(wait);
    countdown(
      warning.delaySeconds,
      (left) => (wait.textContent = `Please wait ${left} seconds before pressing proceed`),
      () => {
        slot.replaceChildren();
        renderChallenge(slot, proceedButton, decision, warning, proceed);
      },
    );
  }

  function renderChallenge(
    slot: HTMLDivElement,
    button: HTMLButtonElement,
    decision: BlockDecision,
    warning: WarningScreen,
    proceed: (minutes?: number) => void,
  ): void {
    const ready = (on: boolean) => (button.disabled = !on);

    if (warning.challenge === "effort" && warning.effortType === "typing") {
      const sentence = document.createElement("p");
      sentence.className = "sentence";
      sentence.textContent = `"${warning.sentence}"`;
      const input = makeInput("input", "Type the exact sentence above");
      // Match Android's typing challenge: the sentence must be entered, not
      // pasted or dragged in from the target text.
      input.addEventListener("paste", (event) => event.preventDefault());
      input.addEventListener("drop", (event) => event.preventDefault());
      const check = () => ready(normalizeLines(input.value) === normalizeLines(warning.sentence));
      input.oninput = check;
      button.onclick = () => !button.disabled && proceed();
      slot.append(sentence, input);
      check();
      input.focus();
      return;
    }

    if (warning.challenge === "effort" && warning.effortType === "intent") {
      const input = makeInput("textarea", "Why do you need to use this site?");
      input.rows = 3;
      const minimum = Math.max(1, warning.minIntentLength);
      const note = makeNote("");
      const check = () => {
        const remaining = Math.max(0, minimum - input.value.trim().length);
        ready(remaining === 0);
        note.textContent =
          remaining > 0 ? `Write at least ${minimum} character${minimum === 1 ? "" : "s"} (${remaining} more to go)` : "";
      };
      input.oninput = check;
      button.onclick = () => !button.disabled && proceed();
      slot.append(input, note);
      check();
      input.focus();
      return;
    }

    if (warning.challenge === "effort" && warning.effortType === "math") {
      renderMathChallenge(slot, button, warning.mathQuestionCount, warning.mathStartingLevel, proceed, (seconds, onTick, onDone) =>
        countdown(seconds, onTick, onDone),
      );
      return;
    }

    // Wait to unlock: a fixed unlock uses the preset minutes; "Ask me how much
    // time I need" lets me choose right here, and asks again next time.
    const minutes = Math.max(1, warning.unlockMinutes);
    ready(true);
    if (decision.reason !== "on-open" && warning.waitType === "dynamic") {
      const label = document.createElement("label");
      label.className = "minutes";
      const input = makeInput("input", "");
      input.type = "number";
      input.inputMode = "numeric";
      input.min = "1";
      input.value = String(minutes);
      input.setAttribute("aria-label", "Minutes");
      const chosen = () => Math.max(1, Math.floor(Number(input.value)) || 0);
      label.append(input, document.createTextNode(" minutes"));
      button.onclick = () => proceed(chosen());
      slot.appendChild(label);
      input.focus();
    } else {
      button.onclick = () => proceed(minutes);
    }
  }

  function hide() {
    for (const id of timers) clearInterval(id);
    timers.clear();
    if (host) {
      lockScroll(false);
      document.removeEventListener("play", stopMedia, true);
    }
    host?.remove();
    host = null;
    shownKey = null;
  }

  return { show, hide };
}

// Android waits this long after a wrong answer before the next try.
const MATH_RETRY_SECONDS = 15;

function renderMathChallenge(
  slot: HTMLDivElement,
  button: HTMLButtonElement,
  questionCount: number,
  startingLevel: number,
  proceed: () => void,
  countdown: (seconds: number, onTick: (left: number) => void, onDone: () => void) => void,
): void {
  const challenge = new AdaptiveMathChallenge(questionCount, startingLevel);
  const required = Math.max(1, questionCount);
  const progress = makeNote("");
  const problem = document.createElement("p");
  problem.className = "problem";
  const input = makeInput("input", "Answer");
  input.inputMode = "decimal";
  input.enterKeyHint = "done";
  const feedback = makeNote("");
  feedback.classList.add("error");
  let waiting = false;
  let complete = false;

  function show(): void {
    problem.textContent = challenge.currentProblem.expression;
    progress.textContent = `${challenge.solvedCount} of ${required} solved`;
    input.value = "";
    input.focus();
  }

  function submit(): void {
    if (complete) return proceed();
    if (waiting) return;
    const raw = input.value.trim().replace(",", ".");
    if (!raw || !Number.isFinite(Number(raw))) {
      feedback.textContent = "Enter a number";
      return;
    }
    const result = challenge.submit(raw);
    if (result.complete) {
      complete = true;
      problem.remove();
      input.remove();
      feedback.textContent = "";
      progress.textContent = `${result.solvedCount} of ${required} solved`;
      button.textContent = "Proceed";
      return;
    }
    feedback.textContent = result.correct ? "" : "Incorrect answer. Wait before trying again.";
    show();
    if (result.correct) return;
    waiting = true;
    button.disabled = true;
    countdown(
      MATH_RETRY_SECONDS,
      (left) => (button.textContent = `Try again in ${left} second${left === 1 ? "" : "s"}`),
      () => {
        waiting = false;
        button.disabled = false;
        button.textContent = "Check answer";
      },
    );
  }

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") submit();
  });
  button.textContent = "Check answer";
  button.disabled = false;
  button.onclick = submit;
  slot.append(progress, problem, input, feedback);
  show();
}

function normalizeLines(value: string): string {
  return value.replace(/\r\n?/g, "\n").trim();
}

// Keep keyboard focus inside the overlay and let Escape lead somewhere calmer.
// Listeners live on `root`, which is removed wholesale in hide(), so they need
// no separate teardown.
function trapFocus(root: HTMLElement, shadow: ShadowRoot, onEscape: () => void): void {
  root.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onEscape();
      return;
    }
    if (e.key !== "Tab") return;
    const items = Array.from(
      root.querySelectorAll<HTMLElement>("button, input, textarea, [href]"),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (items.length === 0) {
      e.preventDefault();
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    const active = shadow.activeElement as HTMLElement | null;
    if (e.shiftKey && (active === first || active === null)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });
}
