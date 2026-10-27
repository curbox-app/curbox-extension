import { HIDER_RULES } from "../lib/ui-hider";
import { Toggle } from "./components";

export function UiHiderPanel({ hidden, onChange }: { hidden: string[]; onChange: (hidden: string[]) => void }) {
  const sites = [...new Set(HIDER_RULES.map((rule) => rule.site))];
  const toggle = (id: string, on: boolean) => onChange(on ? [...hidden, id] : hidden.filter((x) => x !== id));

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="font-display text-5xl text-ink">UI Hider</h1>
        <p className="mt-1 text-sm text-muted">I hide the parts of a site built to keep you scrolling. Changes show up right away.</p>
      </div>
      {sites.map((site) => (
        <div key={site} className="flex flex-col gap-2">
          <p className="label">{site}</p>
          <div className="card flex flex-col px-5">
            {HIDER_RULES.filter((rule) => rule.site === site).map((rule) => (
              <label key={rule.id} className="flex cursor-pointer items-center gap-4 border-b border-line/70 py-4 last:border-b-0">
                <span className="min-w-0 flex-1">
                  <b className="block text-sm font-medium text-ink">{rule.label}</b>
                  <small className="text-xs text-muted">{rule.description}</small>
                </span>
                <Toggle on={hidden.includes(rule.id)} onChange={(on) => toggle(rule.id, on)} />
              </label>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
