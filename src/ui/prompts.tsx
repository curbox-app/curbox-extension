import { useEffect, useRef, useState, type PointerEvent } from "react";
import type { BlockGroup, GentlePromptConfig } from "../lib/types";
import { PROMPT_TEXT_SIZE } from "../lib/types";
import { formatPrompt, promptLook, PROMPT_VARIABLES, type PromptValues } from "../lib/prompt";
import { MatcherList, Segmented, Slider, Toggle, inputCls } from "./components";

const PREVIEW_SCALE = 0.7;

const POSITIONS = [
  { value: "0.05", label: "Top" },
  { value: "0.5", label: "Center" },
  { value: "0.95", label: "Bottom" },
];

function sampleValues(groups: BlockGroup[]): PromptValues {
  const byName = Object.fromEntries(groups.map((g) => [g.name.trim().toLowerCase(), 48 * 60_000]));
  return {
    appName: "YouTube",
    appUsageTodayMs: 42 * 60_000,
    appUsageYesterdayMs: 75 * 60_000,
    appOpensToday: 6,
    screenTimeTodayMs: 3 * 3_600_000 + 12 * 60_000,
    screenTimeYesterdayMs: 4 * 3_600_000 + 5 * 60_000,
    mindfulUsageTodayMs: 58 * 60_000,
    reelCount: 23,
    groupUsageToday: byName,
    groupUsageYesterday: byName,
  };
}

function PositionPad({
  config,
  text,
  onChange,
}: {
  config: GentlePromptConfig;
  text: string;
  onChange: (x: number, y: number) => void;
}) {
  const [drag, setDrag] = useState<{ x: number; y: number } | null>(null);
  const x = drag?.x ?? config.positionX;
  const y = drag?.y ?? config.positionY;

  const pointAt = (e: PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    return { x: clamp((e.clientX - rect.left) / rect.width), y: clamp((e.clientY - rect.top) / rect.height) };
  };

  return (
    <div
      className="relative aspect-[16/10] w-full cursor-grab touch-none overflow-hidden rounded-[var(--radius-card)] bg-surface-2 active:cursor-grabbing"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag(pointAt(e));
      }}
      onPointerMove={(e) => drag && setDrag(pointAt(e))}
      onPointerUp={(e) => {
        const p = pointAt(e);
        setDrag(null);
        onChange(p.x, p.y);
      }}
    >
      <div
        className="pointer-events-none absolute max-w-[80%] whitespace-pre-line rounded-lg px-3 py-2 leading-snug"
        style={{
          ...promptLook(config, PREVIEW_SCALE),
          left: `${x * 100}%`,
          top: `${y * 100}%`,
          transform: `translate(${-x * 100}%, ${-y * 100}%)`,
        }}
      >
        {text}
      </div>
    </div>
  );
}

function ColorRow({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="flex items-center justify-between py-1">
      <span className="text-sm text-ink">{label}</span>
      <span className="flex items-center gap-3">
        <span className="tnum font-mono text-xs uppercase text-muted">{value}</span>
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-8 cursor-pointer appearance-none rounded-full border border-line bg-transparent p-0 [&::-moz-color-swatch]:rounded-full [&::-moz-color-swatch]:border-0 [&::-webkit-color-swatch]:rounded-full [&::-webkit-color-swatch]:border-0 [&::-webkit-color-swatch-wrapper]:p-0"
        />
      </span>
    </label>
  );
}

function SliderRow({
  label,
  value,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-2 py-1">
      <span className="text-sm text-ink">{label}</span>
      <Slider value={value} min={min} max={max} step={1} onChange={onChange} />
    </div>
  );
}

export function GentlePromptPanel({
  config,
  groups,
  onChange,
}: {
  config: GentlePromptConfig;
  groups: BlockGroup[];
  onChange: (config: GentlePromptConfig) => void;
}) {
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const [draft, setDraft] = useState(config);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Sliders and color pickers fire on every move, so save once they settle.
  const patch = (p: Partial<GentlePromptConfig>) => {
    const next = { ...draft, ...p };
    setDraft(next);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      pending.current = null;
      onChange(next);
    }, 300);
  };
  useEffect(() => {
    if (!pending.current) setDraft(config);
  }, [config]);
  const preview = formatPrompt(draft.message, sampleValues(groups), 83_000);
  const groupNames = [...new Set(groups.map((g) => g.name.trim()).filter(Boolean))];
  const variables = [
    ...PROMPT_VARIABLES,
    ...groupNames.flatMap((name) => [`{group_usage_today:${name}}`, `{group_usage_yesterday:${name}}`]),
  ];

  const insert = (variable: string) => {
    const el = messageRef.current;
    const start = el?.selectionStart ?? draft.message.length;
    const end = el?.selectionEnd ?? start;
    patch({ message: draft.message.slice(0, start) + variable + draft.message.slice(end) });
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + variable.length, start + variable.length);
    });
  };

  const snapped = POSITIONS.find((p) => Math.abs(Number(p.value) - draft.positionY) < 0.01)?.value ?? "";

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-5xl text-ink">Gentle Prompts</h1>
        <p className="mt-1 text-sm text-muted">I float a small note over the sites you pick, so you stay aware of your time.</p>
      </div>

      <div className="card flex items-center justify-between p-5">
        <span className="text-base text-ink">Show gentle prompts</span>
        <Toggle on={draft.enabled} onChange={(enabled) => patch({ enabled })} />
      </div>

      <div className="flex flex-col gap-3">
        <p className="label">Position</p>
        <PositionPad config={draft} text={preview} onChange={(positionX, positionY) => patch({ positionX, positionY })} />
        <p className="text-xs text-faint">Drag the note to move it.</p>
        <Segmented
          value={snapped}
          options={POSITIONS}
          onChange={(v) => patch({ positionX: 0.5, positionY: Number(v) })}
        />
      </div>

      <MatcherList label="Sites" matchers={draft.sites} onChange={(sites) => patch({ sites })} />

      <div className="flex flex-col gap-2">
        <p className="label">Message</p>
        <textarea
          ref={messageRef}
          rows={4}
          value={draft.message}
          onChange={(e) => patch({ message: e.target.value })}
          className={`${inputCls} resize-y font-mono leading-relaxed`}
        />
        <p className="text-xs text-faint">Tap a variable to add it. I fill it in live.</p>
        <div className="flex flex-wrap gap-1.5">
          {variables.map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => insert(v)}
              className="rounded-pill bg-surface-2 px-2.5 py-1 font-mono text-[11px] text-muted transition-colors hover:text-ink"
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <p className="label">Look</p>
        <SliderRow
          label={`Text size: ${draft.textSize}px`}
          value={draft.textSize}
          min={PROMPT_TEXT_SIZE.min}
          max={PROMPT_TEXT_SIZE.max}
          onChange={(textSize) => patch({ textSize })}
        />
        <ColorRow label="Text color" value={draft.textColor} onChange={(textColor) => patch({ textColor })} />
        <SliderRow
          label={`Text opacity: ${draft.textOpacity}%`}
          value={draft.textOpacity}
          min={0}
          max={100}
          onChange={(textOpacity) => patch({ textOpacity })}
        />
        <ColorRow label="Background color" value={draft.bgColor} onChange={(bgColor) => patch({ bgColor })} />
        <SliderRow
          label={`Background opacity: ${draft.bgOpacity}%`}
          value={draft.bgOpacity}
          min={0}
          max={100}
          onChange={(bgOpacity) => patch({ bgOpacity })}
        />
      </div>
    </div>
  );
}
