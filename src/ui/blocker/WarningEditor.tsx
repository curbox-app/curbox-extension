import { useState, type ReactNode } from "react";
import type { EffortType, FocusGroup, UnlockChallenge, WaitType, WarningScreen } from "../../lib/types";
import { Dropdown, Toggle, inputCls } from "../components";

// Titles, descriptions and order mirror Android WarningUnlockOptions and
// fragment_warning_config.xml, so one group reads the same on both platforms.
interface UnlockOption<T extends string> {
  value: T;
  title: string;
  description: string;
  recommended?: boolean;
}

const CHALLENGES: UnlockOption<UnlockChallenge>[] = [
  { value: "never", title: "Never Unlock", description: "Total lockdown. No bypassing allowed." },
  {
    value: "effort",
    title: "Require effort to unlock",
    description: "In behavioral psychology, adding physical friction breaks the automatic habit loop, giving your brain a necessary pause to reconsider.",
    recommended: true,
  },
  { value: "wait", title: "Wait to unlock", description: "Allows immediate access after a short wait." },
];

const EFFORT_METHODS: UnlockOption<EffortType>[] = [
  { value: "typing", title: "Unlock requires typing a sentence", description: "Precisely type a long sentence to prove focus." },
  { value: "intent", title: "Unlock requires stating an intent", description: "Briefly describe your goal before accessing." },
  { value: "math", title: "Adaptive math", description: "Solve questions with adaptive difficulty." },
];

const WAIT_METHODS: UnlockOption<WaitType>[] = [
  { value: "dynamic", title: "Ask me how much time I need", description: "You choose the duration during each unlock." },
  { value: "fixed", title: "Only give me a fixed amount of time", description: "Automatically locks after a set duration.", recommended: true },
];

const WINDOW_UNITS = [
  { label: "Minutes", minutes: 1, max: 60 },
  { label: "Hours", minutes: 60, max: 24 },
  { label: "Days", minutes: 1440, max: 30 },
];

// Like Android, show the window in the largest unit that divides it evenly.
function windowUnit(totalMinutes: number): number {
  if (totalMinutes > 0 && totalMinutes % 1440 === 0) return 2;
  if (totalMinutes > 0 && totalMinutes % 60 === 0) return 1;
  return 0;
}

export function WarningEditor({
  warning,
  onChange,
  onEachOpen,
  onChangeOnEachOpen,
  focusGroups,
}: {
  warning: WarningScreen;
  onChange: (warning: WarningScreen) => void;
  onEachOpen: boolean;
  onChangeOnEachOpen: (enabled: boolean) => void;
  focusGroups: FocusGroup[];
}) {
  const [advanced, setAdvanced] = useState(false);
  const [unit, setUnit] = useState(() => windowUnit(warning.proceedWindowMinutes));
  const patch = (value: Partial<WarningScreen>) => onChange({ ...warning, ...value });

  // On each open always grants until I leave the group, so the wait is fixed.
  const toggleOnEachOpen = (enabled: boolean) => {
    onChangeOnEachOpen(enabled);
    if (enabled && warning.challenge === "wait" && warning.waitType === "dynamic") patch({ waitType: "fixed" });
  };

  const { challenge } = warning;
  const waitType: WaitType = onEachOpen ? "fixed" : warning.waitType;
  const showMethod = challenge === "effort" || (challenge === "wait" && !onEachOpen);
  const showDuration = !onEachOpen && (challenge === "effort" || (challenge === "wait" && waitType === "fixed"));
  const windowSize = WINDOW_UNITS[unit];

  return (
    <div className="flex flex-col gap-5">
      <OptionField label="Unlock Challenge" value={challenge} options={CHALLENGES} onChange={(next) => patch({ challenge: next })} />

      {showMethod && challenge === "effort" && (
        <OptionField label="Unlock Method" value={warning.effortType} options={EFFORT_METHODS} onChange={(effortType) => patch({ effortType })} />
      )}
      {showMethod && challenge === "wait" && (
        <OptionField label="Unlock Method" value={waitType} options={WAIT_METHODS} onChange={(next) => patch({ waitType: next })} />
      )}

      {showDuration && (
        <NumberSetting label="Fixed unlock duration" value={warning.unlockMinutes} min={1} onChange={(unlockMinutes) => patch({ unlockMinutes })} suffix="minutes" />
      )}

      {challenge !== "never" && (
        <div className="flex flex-col gap-2">
          <NumberSetting label="Wait before unlocking" value={warning.delaySeconds} min={0} max={3600} onChange={(delaySeconds) => patch({ delaySeconds })} suffix="seconds" />
          <p className="text-xs text-muted">Forces you to think before bypassing the block.</p>
        </div>
      )}

      {challenge === "effort" && warning.effortType === "typing" && (
        <Section title="Typing Authentication" description="Enter the sentence the user must type exactly to bypass the block:">
          <textarea
            value={warning.sentence}
            onChange={(event) => patch({ sentence: event.target.value })}
            placeholder="Required Sentence"
            rows={3}
            className={`${inputCls} resize-y`}
          />
        </Section>
      )}

      {challenge === "effort" && warning.effortType === "intent" && (
        <Section title="Intent unlock length" description="I choose how many characters someone must write before they can continue.">
          <NumberSetting label="Minimum characters" value={warning.minIntentLength} min={1} max={1000} onChange={(minIntentLength) => patch({ minIntentLength })} />
        </Section>
      )}

      {challenge === "effort" && warning.effortType === "math" && (
        <Section title="Adaptive math" description="Choose how many correct answers are required.">
          <NumberSetting label="Questions required" value={warning.mathQuestionCount} min={1} max={10} onChange={(mathQuestionCount) => patch({ mathQuestionCount })} />
          <NumberSetting label="Starting level" value={warning.mathStartingLevel} min={1} max={10} onChange={(mathStartingLevel) => patch({ mathStartingLevel })} />
          <p className="text-xs text-muted">Level 1 uses simple arithmetic. Level 10 combines decimals, fractions, roots, powers, and order of operations.</p>
        </Section>
      )}

      <div className="flex flex-col gap-4 border-t border-line/70 pt-3">
        <button type="button" onClick={() => setAdvanced((value) => !value)} aria-expanded={advanced} className="flex items-center justify-between text-left">
          <span className="text-sm font-medium text-ink">Advanced</span>
          <span className={`text-xs text-muted transition-transform ${advanced ? "rotate-180" : ""}`} aria-hidden="true">▾</span>
        </button>

        {advanced && (
          <>
            <textarea
              value={warning.customMessage}
              onChange={(event) => patch({ customMessage: event.target.value })}
              placeholder="Custom Warning Message"
              rows={2}
              className={`${inputCls} resize-y`}
            />

            <label className="flex items-center justify-between gap-4 text-sm">
              Show this screen each time I open the selected websites
              <Toggle on={onEachOpen} onChange={toggleOnEachOpen} />
            </label>

            {challenge !== "never" && (
              <>
                <label className="flex items-center justify-between text-sm">
                  Daily focus requirement
                  <Toggle on={warning.focusGoalEnabled} onChange={(focusGoalEnabled) => patch({ focusGoalEnabled })} />
                </label>
                {warning.focusGoalEnabled && (
                  <Section description="Unlocking is allowed after the selected focus time is completed today.">
                    <Dropdown
                      label="Focus group"
                      placeholder="Select a focus group"
                      value={warning.focusGoalGroupId}
                      options={focusGroups.map((group) => ({ value: group.id, label: group.name }))}
                      onChange={(focusGoalGroupId) => patch({ focusGoalGroupId })}
                    />
                    <NumberSetting label="Required focus time" value={warning.focusGoalRequiredMinutes} min={15} max={1440} onChange={(focusGoalRequiredMinutes) => patch({ focusGoalRequiredMinutes })} suffix="minutes" />
                  </Section>
                )}

                <label className="flex items-center justify-between text-sm">
                  Limit unlock frequency
                  <Toggle on={warning.proceedLimit > 0} onChange={(limited) => patch({ proceedLimit: limited ? Math.max(1, warning.proceedLimit) : 0 })} />
                </label>
                {warning.proceedLimit > 0 && (
                  <Section>
                    <NumberSetting label="Allowed proceeds" value={warning.proceedLimit} min={1} max={100} onChange={(proceedLimit) => patch({ proceedLimit })} />
                    <label className="flex flex-wrap items-center gap-2 text-sm">
                      Time window
                      <NumberInput
                        value={Math.max(1, Math.round(warning.proceedWindowMinutes / windowSize.minutes))}
                        min={1}
                        max={windowSize.max}
                        onChange={(count) => patch({ proceedWindowMinutes: count * windowSize.minutes })}
                      />
                      <div className="w-32">
                        <Dropdown
                          ariaLabel="Time window unit"
                          value={String(unit)}
                          options={WINDOW_UNITS.map((option, index) => ({ value: String(index), label: option.label }))}
                          onChange={(value) => {
                            const next = Number(value);
                            const count = Math.min(WINDOW_UNITS[next].max, Math.max(1, Math.round(warning.proceedWindowMinutes / WINDOW_UNITS[next].minutes)));
                            setUnit(next);
                            patch({ proceedWindowMinutes: count * WINDOW_UNITS[next].minutes });
                          }}
                        />
                      </div>
                    </label>
                  </Section>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

export function warningSummary(warning: WarningScreen, onEachOpen: boolean): string {
  const challenge = CHALLENGES.find((option) => option.value === warning.challenge)!.title;
  if (warning.challenge === "effort") return `${challenge}: ${EFFORT_METHODS.find((option) => option.value === warning.effortType)!.title}`;
  if (warning.challenge === "wait") {
    const waitType = onEachOpen ? "fixed" : warning.waitType;
    return `${challenge}: ${WAIT_METHODS.find((option) => option.value === waitType)!.title}`;
  }
  return challenge;
}

function Section({ title, description, children }: { title?: string; description?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      {title && <p className="text-sm font-medium text-ink">{title}</p>}
      {description && <p className="text-xs text-muted">{description}</p>}
      {children}
    </div>
  );
}

// Android's unlock dropdowns: each row has a description and the advised one
// carries a Recommended badge. The chosen option's description stays visible.
function OptionField<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: UnlockOption<T>[];
  onChange: (value: T) => void;
}) {
  const selected = options.find((option) => option.value === value);
  return (
    <div className="flex flex-col gap-1.5">
      <Dropdown
        label={label}
        value={value}
        options={options.map(({ value, title, description, recommended }) => ({ value, label: title, description, recommended }))}
        onChange={onChange}
      />
      {selected && <span className="text-xs text-muted">{selected.description}</span>}
    </div>
  );
}

function NumberSetting({ label, value, min, max, onChange, suffix }: { label: string; value: number; min: number; max?: number; onChange: (value: number) => void; suffix?: string }) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-sm">
      {label}
      <NumberInput value={value} min={min} max={max} onChange={onChange} />
      {suffix}
    </label>
  );
}

function NumberInput({ value, min, max, onChange }: { value: number; min: number; max?: number; onChange: (value: number) => void }) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      value={value}
      onChange={(event) => {
        const parsed = Math.floor(Number(event.target.value));
        onChange(Math.min(max ?? Number.MAX_SAFE_INTEGER, Math.max(min, Number.isFinite(parsed) ? parsed : min)));
      }}
      className={`${inputCls.replace("w-full", "")} w-20 shrink-0`}
    />
  );
}
