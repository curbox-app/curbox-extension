import { get, watch } from "../lib/storage";
import { groupMatches } from "../lib/match";
import { formatPrompt, promptLook } from "../lib/prompt";
import { sendToBackground, type PromptReply } from "../lib/messages";
import { parseLocation } from "../lib/url";
import type { GentlePromptConfig } from "../lib/types";

const STYLE = `
:host { all: initial; }
.prompt {
  position: fixed;
  z-index: 2147483646;
  max-width: min(420px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 12px 16px;
  border-radius: 12px;
  font-family: "Inter", system-ui, -apple-system, "Segoe UI", sans-serif;
  line-height: 1.45;
  white-space: pre-line;
  overflow-wrap: anywhere;
  pointer-events: none;
  user-select: none;
  opacity: 0;
  transition: opacity 0.6s cubic-bezier(0.22, 0.61, 0.36, 1);
}
.prompt.visible { opacity: 1; }
@media (prefers-reduced-motion: reduce) {
  .prompt { transition: none; }
}
`;

const REFRESH_EVERY_S = 5;

// Keeps the prompt's center at the chosen spot while never letting it leave
// the screen, like the Android overlay.
function place(el: HTMLElement, config: GentlePromptConfig): void {
  const { width, height } = el.getBoundingClientRect();
  const clamp = (value: number, max: number) => Math.min(Math.max(0, value), Math.max(0, max));
  el.style.left = `${clamp(innerWidth * config.positionX - width / 2, innerWidth - width)}px`;
  el.style.top = `${clamp(innerHeight * config.positionY - height / 2, innerHeight - height)}px`;
}

export function createPrompt(): { refresh: () => void } {
  let host: HTMLDivElement | null = null;
  let box: HTMLDivElement | null = null;
  let reply: PromptReply = null;
  let wanted = false;
  let sessionStart = 0;
  let ticks = 0;
  let timer: ReturnType<typeof setInterval> | null = null;

  function mount(): HTMLDivElement {
    host = document.createElement("div");
    host.id = "curbox-prompt-host";
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    box = document.createElement("div");
    box.className = "prompt";
    box.setAttribute("aria-live", "off");
    shadow.append(style, box);
    (document.documentElement || document.body).appendChild(host);
    const shown = box;
    requestAnimationFrame(() => shown.classList.add("visible"));
    return box;
  }

  function render(): void {
    if (!reply) return;
    const el = box ?? mount();
    Object.assign(el.style, promptLook(reply.config));
    el.textContent = formatPrompt(reply.config.message, reply.values, Date.now() - sessionStart);
    place(el, reply.config);
  }

  function hide(): void {
    host?.remove();
    host = null;
    box = null;
    reply = null;
    sessionStart = 0;
    if (timer) clearInterval(timer);
    timer = null;
  }

  async function fetchValues(): Promise<void> {
    const next = await sendToBackground<PromptReply>({ type: "prompt", url: location.href }).catch(() => null);
    if (!wanted || document.visibilityState !== "visible") return;
    if (!next) return hide();
    reply = next;
    if (!sessionStart) sessionStart = Date.now();
    render();
  }

  function start(): void {
    if (timer) return;
    ticks = 0;
    void fetchValues();
    timer = setInterval(() => {
      ticks += 1;
      if (ticks % REFRESH_EVERY_S === 0) void fetchValues();
      else render();
    }, 1000);
  }

  // Cheap local check first, so pages with no prompt never wake the worker.
  async function refresh(): Promise<void> {
    const loc = parseLocation(location.href);
    const config = (await get("settings")).gentlePrompt;
    wanted = !!loc && config.enabled && groupMatches(loc, config.sites);
    if (wanted && document.visibilityState === "visible") {
      if (timer) void fetchValues();
      else start();
    } else hide();
  }

  document.addEventListener("visibilitychange", () => void refresh());
  addEventListener("resize", () => box && reply && place(box, reply.config));
  watch((changed) => {
    if ("settings" in changed) void refresh();
  });
  void refresh();

  return { refresh: () => void refresh() };
}
