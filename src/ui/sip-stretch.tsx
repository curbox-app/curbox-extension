import type { SipStretchConfig } from "../lib/types";
import { SIP_STRETCH } from "../lib/types";
import { MatcherList, Slider, Toggle } from "./components";
import { useSettledDraft } from "./useDraft";

function MinutesCard({
  label,
  value,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="card flex flex-col gap-3 p-5">
      <div className="flex items-center justify-between">
        <span className="text-base text-ink">{label}</span>
        <span className="tnum text-sm font-medium text-primary">{value} min</span>
      </div>
      <Slider value={value} min={min} max={max} step={step} onChange={onChange} />
    </div>
  );
}

export function SipStretchPanel({
  config,
  onChange,
}: {
  config: SipStretchConfig;
  onChange: (config: SipStretchConfig) => void;
}) {
  const [draft, patch] = useSettledDraft(config, onChange);
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-5xl text-ink">Sip &amp; Stretch</h1>
        <p className="mt-1 text-sm text-muted">
          When you spend too long on the sites you pick, your browser takes a short break. All sites are blocked until the
          break ends, so you can drink water, stand up, and stretch.
        </p>
      </div>

      <div className="card flex items-center justify-between p-5">
        <span className="text-base text-ink">Enable Sip &amp; Stretch</span>
        <Toggle on={draft.enabled} onChange={(enabled) => patch({ enabled })} />
      </div>

      <MatcherList label="Target sites" matchers={draft.sites} onChange={(sites) => patch({ sites })} />

      <div className="flex flex-col gap-3">
        <MinutesCard
          label="Break after"
          value={draft.usageLimitMinutes}
          min={SIP_STRETCH.minUsageMinutes}
          max={SIP_STRETCH.maxUsageMinutes}
          step={SIP_STRETCH.usageStep}
          onChange={(usageLimitMinutes) => patch({ usageLimitMinutes })}
        />
        <MinutesCard
          label="Break length"
          value={draft.breakMinutes}
          min={SIP_STRETCH.minBreakMinutes}
          max={SIP_STRETCH.maxBreakMinutes}
          step={1}
          onChange={(breakMinutes) => patch({ breakMinutes })}
        />
        <p className="text-xs text-faint">
          Time away from these sites counts as rest. If you stay away as long as one break, the timer starts over.
        </p>
      </div>
    </div>
  );
}
