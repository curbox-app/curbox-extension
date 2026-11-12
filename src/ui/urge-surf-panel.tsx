import { useEffect, useState } from "react";
import { get, set, watch } from "../lib/storage";
import type { CravingSession, UrgeSurfConfig } from "../lib/types";
import { btnGhost, Toggle } from "./components";
import { plural } from "../lib/urge-surf";

const average = (values: number[]) => (values.reduce((a, b) => a + b, 0) / values.length).toFixed(1);

function useCravings(): CravingSession[] {
  const [cravings, setCravings] = useState<CravingSession[]>([]);
  useEffect(() => {
    void get("cravings").then(setCravings);
    return watch((changed) => {
      if ("cravings" in changed) setCravings(changed.cravings ?? []);
    });
  }, []);
  return cravings;
}

function ToggleRow({ label, on, onChange }: { label: string; on: boolean; onChange: (on: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <span className="text-base text-ink">{label}</span>
      <Toggle on={on} onChange={onChange} />
    </div>
  );
}

function Stats({ cravings }: { cravings: CravingSession[] }) {
  const [confirming, setConfirming] = useState(false);
  if (cravings.length === 0) {
    return <p className="text-sm text-muted">Nothing here yet. Your results will show up here after you ride out a craving.</p>;
  }
  const count = cravings.length;
  const wentDown = cravings.filter((c) => c.ratingAfter < c.ratingBefore).length;
  return (
    <div className="flex flex-col gap-2">
      <p className="text-base font-medium text-ink">{plural(count, "You rode out %d craving.", "You rode out %d cravings.")}</p>
      <p className="text-sm text-muted">
        On average your craving went from {average(cravings.map((c) => c.ratingBefore))} to{" "}
        {average(cravings.map((c) => c.ratingAfter))}.
      </p>
      <p className="text-sm text-muted">
        {plural(wentDown, "It went down %d time", "It went down %d times")} out of {count}.
      </p>
      {confirming ? (
        <div className="mt-2 flex flex-col gap-2">
          <p className="text-sm text-ink">Delete all your craving results? This cannot be undone.</p>
          <div className="flex justify-end gap-2">
            <button onClick={() => setConfirming(false)} className={btnGhost}>
              Cancel
            </button>
            <button onClick={() => void set("cravings", []).then(() => setConfirming(false))} className={`${btnGhost} text-primary`}>
              Delete
            </button>
          </div>
        </div>
      ) : (
        <button onClick={() => setConfirming(true)} className={`mt-1 self-end ${btnGhost} text-primary`}>
          Clear history
        </button>
      )}
    </div>
  );
}

export function UrgeSurfPanel({ config, onChange }: { config: UrgeSurfConfig; onChange: (config: UrgeSurfConfig) => void }) {
  const cravings = useCravings();
  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-5xl text-ink">Urge Surfing</h1>
        <p className="mt-1 text-sm text-muted">
          A craving is like a wave. It rises, peaks, and fades, usually within a few minutes. Urge surfing helps you wait it
          out. You rate the craving, think about it for a moment, then play a calm puzzle or move your body for 3 minutes.
          Then you rate it again and see how much it dropped.
        </p>
      </div>

      <div className="card flex flex-col p-5">
        <ToggleRow
          label={`Show "I'm struggling" on block screens`}
          on={config.buttonEnabled}
          onChange={(buttonEnabled) => onChange({ ...config, buttonEnabled })}
        />
        <ToggleRow
          label="Offer help after 3 unlocks in a row"
          on={config.autoOfferEnabled}
          onChange={(autoOfferEnabled) => onChange({ ...config, autoOfferEnabled })}
        />
        <p className="mt-1 text-xs text-faint">
          Getting past the block screen again and again is a sign of a strong craving. After 3 unlocks in a row, the block
          screen offers help even if the button above is off. Tapping Cancel starts the count over.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <p className="label">Your cravings</p>
        <div className="card p-5">
          <Stats cravings={cravings} />
        </div>
      </div>
    </div>
  );
}
