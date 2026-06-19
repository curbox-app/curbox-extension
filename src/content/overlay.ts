import type { BlockDecision, WarningScreen } from "../lib/types";

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
  background: #faf9f7;
  color: #1c1c1c;
  opacity: 0;
  transition: opacity 0.5s ease;
}
.curbox-root.visible { opacity: 1; }
@media (prefers-color-scheme: dark) {
  .curbox-root { background: #0b0b0b; color: #ededed; }
  .breath { border-color: rgba(237, 237, 237, 0.5); }
  .breath span { color: rgba(237, 237, 237, 0.65); }
  .ghost { color: rgba(237, 237, 237, 0.6); }
  input, textarea { color: #ededed; border-color: rgba(237,237,237,0.3); }
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
.breath {
  width: 92px;
  height: 92px;
  border-radius: 50%;
  border: 1.5px solid rgba(28, 28, 28, 0.4);
  display: flex;
  align-items: center;
  justify-content: center;
  animation: breathe 6s ease-in-out infinite;
}
.breath span {
  font-size: 12px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: rgba(28, 28, 28, 0.55);
}
@keyframes breathe {
  0%, 100% { transform: scale(0.82); }
  50% { transform: scale(1.12); }
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
  border: 1px solid rgba(28, 28, 28, 0.25);
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
.ghost {
  border: none;
  background: none;
  color: rgba(28, 28, 28, 0.6);
  padding: 8px;
}
.ghost:hover { opacity: 0.7; }
`;

export interface OverlayHandlers {
  onProceed: () => void;
  onLeave: () => void;
  onEndFocus: () => void;
}

export interface Overlay {
  show: (decision: BlockDecision, handlers: OverlayHandlers) => void;
  hide: () => void;
}

export function createOverlay(): Overlay {
  let host: HTMLDivElement | null = null;
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
    if (host) hide();
    const shadow = mount();
    document.documentElement.style.overflow = "hidden";

    const root = document.createElement("div");
    root.className = "curbox-root";
    root.innerHTML = `
      <div class="card">
        <div class="breath"><span>Breathe</span></div>
        <p class="message">${escapeHtml(decision.message)}</p>
        <div class="body"></div>
        <button class="ghost">Take me somewhere calmer</button>
      </div>`;
    shadow.appendChild(root);
    requestAnimationFrame(() => root.classList.add("visible"));
    root.querySelector<HTMLButtonElement>(".ghost")!.onclick = handlers.onLeave;

    const body = root.querySelector<HTMLDivElement>(".body")!;

    if (decision.source === "focus") {
      renderFocus(body, decision, handlers);
      return;
    }

    const warning = decision.warning;
    const proceed = () => {
      handlers.onProceed();
      hide();
    };

    if (warning && warning.delaySeconds > 0) {
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
      const button = document.createElement("button");
      button.className = "primary";
      button.textContent = "End focus session";
      button.onclick = () => {
        handlers.onEndFocus();
        hide();
      };
      body.appendChild(button);
    } else {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = "I'll stay until the timer is done.";
      body.appendChild(note);
    }
  }

  function renderChallenge(body: HTMLDivElement, decision: BlockDecision, proceed: () => void): void {
    const warning = decision.warning;

    if (!decision.canProceed) {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent =
        warning?.challenge === "never"
          ? "This one stays closed for now."
          : "You've used all your passes for now. Come back later.";
      body.appendChild(note);
      return;
    }

    const button = document.createElement("button");
    button.className = "primary";
    button.disabled = true;

    if (warning?.challenge === "effort") {
      const sentence = document.createElement("p");
      sentence.className = "sentence";
      sentence.textContent = warning.sentence;
      const input = document.createElement("input");
      input.setAttribute("autocomplete", "off");
      input.placeholder = "Type it here";
      const check = () => (button.disabled = input.value.trim() !== warning.sentence.trim());
      input.oninput = check;
      button.textContent = "Continue";
      button.onclick = () => !button.disabled && proceed();
      body.append(sentence, input, button);
      check();
      input.focus();
      return;
    }

    // Wait challenge (or no warning): a timed pause before the button unlocks.
    const seconds = waitSeconds(warning);
    button.onclick = () => !button.disabled && proceed();
    body.appendChild(button);
    countdown(
      seconds,
      (left) => {
        if (left > 0) {
          button.disabled = true;
          button.textContent = `I'll open this in ${left}s`;
        } else {
          button.disabled = false;
          button.textContent = "Continue anyway";
        }
      },
      () => {},
    );
  }

  function hide() {
    for (const id of timers) clearInterval(id);
    timers.clear();
    document.documentElement.style.overflow = "";
    host?.remove();
    host = null;
  }

  return { show, hide };
}

function waitSeconds(warning: WarningScreen | null): number {
  if (!warning) return 0;
  if (warning.challenge !== "wait") return 0;
  if (warning.waitType === "dynamic") {
    const max = Math.max(3, warning.waitSeconds);
    return Math.floor(3 + Math.random() * (max - 3 + 1));
  }
  return Math.max(0, warning.waitSeconds);
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!;
  });
}
