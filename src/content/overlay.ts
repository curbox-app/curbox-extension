import type { BlockDecision } from "../lib/types";

const STYLE = `
:host { all: initial; }
.curbox-root {
  position: fixed;
  inset: 0;
  z-index: 2147483647;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  background: #f5f3ef;
  color: #1a1917;
  opacity: 0;
  transition: opacity 0.6s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.curbox-root.visible { opacity: 1; }
@media (prefers-color-scheme: dark) {
  .curbox-root { background: #0b0b0c; color: #edece9; }
  input, textarea { color: #edece9; border-color: rgba(237,236,233,0.28); }
}
.card {
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
.note { font-size: 14px; opacity: 0.6; margin: 0; }
input, textarea {
  font-family: inherit;
  font-size: 15px;
  width: 100%;
  max-width: 340px;
  background: transparent;
  border: 1px solid rgba(26, 25, 23, 0.25);
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

`;

function makePrimary(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
  const button = document.createElement("button");
  button.className = "primary";
  button.textContent = label;
  button.disabled = disabled;
  button.onclick = onClick;
  return button;
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
    document.documentElement.style.overflow = "hidden";

    const root = document.createElement("div");
    root.className = "curbox-root";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "A mindful pause from Curbox");
    root.innerHTML = `
      <div class="card" tabindex="-1">
        <p class="message">${escapeHtml(decision.message)}</p>
        <div class="body"></div>
      </div>`;
    shadow.appendChild(root);
    requestAnimationFrame(() => root.classList.add("visible"));
    root.querySelector<HTMLElement>(".card")!.focus();
    trapFocus(root, shadow, handlers.onLeave);

    const body = root.querySelector<HTMLDivElement>(".body")!;

    if (decision.source === "focus") {
      renderFocus(body, decision, handlers);
      return;
    }

    const warning = decision.warning;
    const proceed = (minutes?: number) => {
      handlers.onProceed(minutes);
      hide();
    };

    if (warning && warning.delaySeconds > 0 && decision.canProceed) {
      const wait = document.createElement("p");
      wait.className = "note";
      body.appendChild(wait);
      countdown(
        warning.delaySeconds,
        (left) => (wait.textContent = `Hold on a moment… ${left}s`),
        () => {
          body.innerHTML = "";
          renderChallenge(body, decision, proceed);
        },
      );
    } else {
      renderChallenge(body, decision, proceed);
    }
  }

  function renderFocus(body: HTMLDivElement, decision: BlockDecision, handlers: OverlayHandlers): void {
    if (decision.focusExitable) {
      body.appendChild(
        makePrimary("End focus session", () => {
          handlers.onEndFocus();
          hide();
        }),
      );
    } else {
      body.appendChild(makeNote("I'll stay until the timer is done."));
    }
  }

  function renderChallenge(body: HTMLDivElement, decision: BlockDecision, proceed: (minutes?: number) => void): void {
    const warning = decision.warning;

    if (!decision.canProceed) {
      body.appendChild(
        makeNote(
          warning?.challenge === "never"
            ? "This one stays closed for now."
            : "You've used all your passes for now. Come back later.",
        ),
      );
      return;
    }

    if (warning?.challenge === "effort") {
      const sentence = document.createElement("p");
      sentence.className = "sentence";
      sentence.textContent = warning.sentence;
      const input = document.createElement("input");
      input.setAttribute("autocomplete", "off");
      input.placeholder = "Type it here";
      const button = makePrimary("Continue", () => !button.disabled && proceed(), true);
      const check = () => (button.disabled = input.value.trim() !== warning.sentence.trim());
      input.oninput = check;
      body.append(sentence, input, button);
      check();
      input.focus();
      return;
    }

    // Wait to unlock: grant temporary access. Fixed uses the preset minutes;
    // dynamic lets me choose how long right here, then asks again next time.
    const minutes = Math.max(1, warning?.unlockMinutes ?? 15);
    if (warning?.waitType === "dynamic") {
      const input = document.createElement("input");
      input.type = "number";
      input.min = "1";
      input.value = String(minutes);
      input.setAttribute("autocomplete", "off");
      const chosen = () => Math.max(1, Math.floor(Number(input.value)) || 0);
      const button = makePrimary(`Unlock for ${chosen()} min`, () => proceed(chosen()));
      input.oninput = () => (button.textContent = `Unlock for ${chosen()} min`);
      body.append(input, button);
      input.focus();
    } else {
      body.appendChild(makePrimary(`Unlock for ${minutes} min`, () => proceed(minutes)));
    }
  }

  function hide() {
    for (const id of timers) clearInterval(id);
    timers.clear();
    document.documentElement.style.overflow = "";
    host?.remove();
    host = null;
    shownKey = null;
  }

  return { show, hide };
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

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!;
  });
}
