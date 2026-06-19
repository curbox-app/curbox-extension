import { useState } from "react";
import type { WarningScreen } from "../../lib/types";
import { Segmented, inputCls } from "../components";

export function WarningEditor({ warning, onChange }: { warning: WarningScreen; onChange: (w: WarningScreen) => void }) {
  const [open, setOpen] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const patch = (p: Partial<WarningScreen>) => onChange({ ...warning, ...p });

  return (
    <div className="card flex flex-col gap-3 p-4">
      <button onClick={() => setOpen((v) => !v)} className="flex items-center justify-between text-left">
        <span className="text-sm">Warning screen</span>
        <span className="text-xs font-medium text-muted">{open ? "Hide" : "Configure"}</span>
      </button>

      {open && (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <p className="text-xs text-muted">When I try to get past this</p>
            <Segmented
              value={warning.challenge}
              options={[
                { value: "never", label: "Never unlock" },
                { value: "effort", label: "Type sentence" },
                { value: "wait", label: "Wait to unlock" },
              ]}
              onChange={(challenge) => patch({ challenge })}
            />
          </div>

          {warning.challenge === "effort" && (
            <input
              value={warning.sentence}
              onChange={(e) => patch({ sentence: e.target.value })}
              placeholder="Sentence I must type"
              className={inputCls}
            />
          )}

          {warning.challenge === "wait" && (
            <div className="flex flex-col gap-2">
              <Segmented
                value={warning.waitType}
                options={[
                  { value: "fixed", label: "Fixed time" },
                  { value: "dynamic", label: "Dynamic time" },
                ]}
                onChange={(waitType) => patch({ waitType })}
              />
              {warning.waitType === "fixed" ? (
                <label className="text-sm flex items-center gap-2">
                  Unlock for
                  <input
                    type="number"
                    min={1}
                    value={warning.unlockMinutes ?? 15}
                    onChange={(e) => patch({ unlockMinutes: Math.max(1, Number(e.target.value)) })}
                    className={`${inputCls} w-16`}
                  />
                  minutes
                </label>
              ) : (
                <p className="text-xs text-muted">I'll ask how long you need each time you unlock.</p>
              )}
            </div>
          )}

          {warning.challenge !== "never" && (
            <label className="text-sm flex items-center gap-2">
              Brief pause of
              <input
                type="number"
                min={0}
                value={warning.delaySeconds}
                onChange={(e) => patch({ delaySeconds: Math.max(0, Number(e.target.value)) })}
                className={`${inputCls} w-16`}
              />
              seconds first
            </label>
          )}

          <div className="flex flex-col gap-4 border-t border-line/70 pt-3">
            <button onClick={() => setAdvanced((v) => !v)} className="flex items-center justify-between text-left">
              <span className="text-xs font-medium text-muted">Advanced</span>
              <span className="text-xs font-medium text-muted">{advanced ? "Hide" : "Show"}</span>
            </button>

            {advanced && (
              <>
                <textarea
                  value={warning.customMessage}
                  onChange={(e) => patch({ customMessage: e.target.value })}
                  placeholder="A message to myself (optional)"
                  rows={2}
                  className={`${inputCls} resize-none`}
                />

                {warning.challenge !== "never" && (
                  <>
                    <label className="text-sm flex items-center gap-2 flex-wrap">
                      Let me through
                      <input
                        type="number"
                        min={0}
                        value={warning.proceedLimit}
                        onChange={(e) => patch({ proceedLimit: Math.max(0, Number(e.target.value)) })}
                        className={`${inputCls} w-14`}
                      />
                      times every
                      <input
                        type="number"
                        min={1}
                        value={warning.proceedWindowMinutes}
                        onChange={(e) => patch({ proceedWindowMinutes: Math.max(1, Number(e.target.value)) })}
                        className={`${inputCls} w-14`}
                      />
                      minutes
                    </label>
                    <p className="text-xs text-muted">Set passes to 0 for no limit.</p>
                  </>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
