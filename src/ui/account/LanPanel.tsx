import { useCallback, useEffect, useState } from "react";
import { browser } from "#imports";
import { btnGhost, btnOutline, btnPrimary, inputCls } from "../components";
import { formatShort, normalizeShort, SHORT_LENGTH } from "../../lib/lan/shortcode";
import type { LanRequest, LanResponse, LanStatus } from "../../lib/lan/engine";
import type { PhoneState } from "../../lib/lan/reconcile";

// This computer's own WiFi address tells the search where to look first. Many
// browsers hide it, in which case the search just starts with common ranges.
async function localAddressHint(): Promise<string | null> {
  if (typeof RTCPeerConnection === "undefined") return null;
  const pc = new RTCPeerConnection({ iceServers: [] });
  try {
    pc.createDataChannel("hint");
    const found = new Promise<string | null>((resolve) => {
      pc.onicecandidate = (e) => {
        const ip = e.candidate?.candidate.match(/(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})/)?.[1];
        if (ip && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)) resolve(ip);
        if (!e.candidate) resolve(null);
      };
      setTimeout(() => resolve(null), 1000);
    });
    await pc.setLocalDescription(await pc.createOffer());
    return await found;
  } catch {
    return null;
  } finally {
    pc.close();
  }
}

async function send(req: LanRequest): Promise<LanResponse> {
  return (await browser.runtime.sendMessage(req)) as LanResponse;
}

function ago(at: number): string {
  const min = Math.round((Date.now() - at) / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  if (min < 48 * 60) return `${Math.floor(min / 60)}h ago`;
  return `${Math.floor(min / 1440)}d ago`;
}

function timeLeft(endsAt: number): string {
  const min = Math.max(0, Math.round((endsAt - Date.now()) / 60_000));
  return min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m left` : `${min}m left`;
}

function phoneFocusText(phone: PhoneState): string {
  if (!phone.active) return "Focus is off on your phone";
  const p = phone.pomodoro;
  if (p && p.rounds > 0) {
    if (phone.phase === "break") return `Phone on a break, ${timeLeft(phone.endsAt)} before round ${p.completed + 1} of ${p.rounds}`;
    return `Phone focus: ${phone.name || "Focus"}, round ${p.completed + 1} of ${p.rounds}, ${timeLeft(phone.endsAt)}`;
  }
  return `Phone focus: ${phone.name || "Focus"}, ${timeLeft(phone.endsAt)}`;
}

export function LanPanel() {
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [synced, setSynced] = useState(false);

  const run = useCallback(async (req: LanRequest) => {
    setBusy(req.type !== "lan:status");
    try {
      const res = await send(req);
      setStatus(res.status);
      if (req.type !== "lan:status") setError(res.ok ? null : (res.error ?? "Something went wrong."));
      return res;
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void run({ type: "lan:status" });
    const timer = window.setInterval(() => void run({ type: "lan:status" }), 3000);
    return () => window.clearInterval(timer);
  }, [run]);

  const [hint, setHint] = useState<string | null>(null);

  // This computer's address tells the background which network it is on now.
  useEffect(() => {
    void localAddressHint().then((h) => {
      setHint(h);
      if (h) void send({ type: "lan:hint", hint: h });
    });
  }, []);

  const pair = useCallback(
    (typed: string) => void run({ type: "lan:pairCode", code: typed, hint }).then((r) => r.ok && setCode("")),
    [run, hint],
  );

  const onCode = (value: string) => {
    const clean = normalizeShort(value).slice(0, SHORT_LENGTH);
    setCode(clean);
    if (clean.length === SHORT_LENGTH && !busy) pair(clean);
  };

  if (!status) return <p className="text-sm text-muted">One moment...</p>;

  const header = (
    <div>
      <h1 className="font-display text-5xl text-ink">Phone sync</h1>
      <p className="mt-1 text-sm text-muted">
        Keep focus mode in step with Curbox on your Android phone. Everything stays between your devices.
      </p>
    </div>
  );

  if (!status.paired) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="card flex flex-col items-center gap-4 p-6 text-center">
          <p className="font-display text-3xl leading-none">Type the code from your phone</p>
          <p className="text-sm text-muted">Open Curbox Sync on your phone. The code is at the top. Both need the same WiFi for this first step.</p>
          <input
            className={`${inputCls} w-56 text-center font-mono text-3xl uppercase tracking-[0.3em]`}
            placeholder="ABC 123"
            aria-label="Code from your phone"
            autoFocus
            autoComplete="off"
            spellCheck={false}
            value={formatShort(code)}
            disabled={busy}
            onChange={(e) => onCode(e.target.value)}
          />
          <p className="text-sm text-ink">{busy ? "Pairing..." : error ?? " "}</p>
          {!busy && code.length === SHORT_LENGTH && error && (
            <button className={btnOutline} onClick={() => pair(code)}>
              Try again
            </button>
          )}
        </div>
      </div>
    );
  }

  const phone = status.phone;
  const here = status.places.find((p) => p.id === status.placeId);
  const via = status.via === "tailscale" ? "Tailscale" : here?.label || "WiFi";
  const others = status.places.filter((p) => p.id !== status.placeId);
  const note = error ?? status.message;
  return (
    <div className="flex flex-col gap-5">
      {header}

      <div className="card flex flex-col gap-3 p-6">
        <div className="flex items-center gap-3">
          <span className={`h-3 w-3 shrink-0 rounded-full ${status.reachable ? "bg-primary" : "bg-faint animate-pulse"}`} />
          <p className="font-display text-3xl leading-none">{status.reachable ? "Connected" : "Looking for your phone"}</p>
        </div>
        <p className="text-sm text-muted">
          {status.reachable
            ? `Through ${via} · synced ${ago(status.lastOkAt)}`
            : status.lastOkAt > 0
              ? `Last synced ${ago(status.lastOkAt)}. Open Curbox Sync on your phone.`
              : "Open Curbox Sync on your phone."}
        </p>
        {phone?.connected && status.reachable && <p className="text-sm text-ink">{phoneFocusText(phone)}</p>}
        {phone?.connected && status.reachable && !phone.caps?.includes("groups") && (
          <p className="text-sm text-muted">Update Curbox on your phone to share focus groups and Pomodoro too.</p>
        )}
        {note && <p className="text-sm text-muted">{note}</p>}
        <div className="flex flex-wrap gap-2">
          {status.reachable ? (
            <button
              className={btnOutline}
              disabled={busy}
              onClick={() =>
                void run({ type: "lan:syncNow" }).then((r) => {
                  if (!r.ok) return;
                  setSynced(true);
                  window.setTimeout(() => setSynced(false), 2500);
                })
              }
            >
              {busy ? "Syncing..." : synced ? "Synced" : "Sync now"}
            </button>
          ) : (
            <button className={btnPrimary} disabled={busy} onClick={() => void run({ type: "lan:search" })}>
              {busy ? "Looking..." : "Find my phone"}
            </button>
          )}
        </div>
      </div>

      <TailscaleCard state={status.tailscale} via={status.via} />

      {others.length > 0 && (
        <details className="group">
          <summary className="label cursor-pointer list-none px-1">
            {others.length} other saved WiFi network{others.length === 1 ? "" : "s"}{" "}
            <span className="text-faint group-open:hidden">· show</span>
          </summary>
          <p className="px-1 pt-1 text-xs text-faint">Your phone is found on these by itself. Rename them in Curbox Sync.</p>
          <div className="mt-1 flex flex-col gap-1">
            {others.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl px-1 py-2">
                <span className="flex-1">
                  <b className="block text-sm text-ink">{p.label || "WiFi"}</b>
                  <small className="text-muted">Last used {ago(p.lastOkAt)}</small>
                </span>
                <button className={btnGhost} disabled={busy} onClick={() => void run({ type: "lan:forgetPlace", id: p.id })}>
                  Forget
                </button>
              </div>
            ))}
          </div>
        </details>
      )}

      <div className="flex items-center justify-between gap-2">
        {status.usageSentAt > 0 && status.usageSentAt <= Date.now() ? (
          <p className="text-xs text-faint">Site time shared with your phone {ago(status.usageSentAt)}.</p>
        ) : (
          <span />
        )}
        <button className={btnGhost} disabled={busy} onClick={() => void run({ type: "lan:unpair" })}>
          Unpair
        </button>
      </div>
    </div>
  );
}

const TAILSCALE_DOWNLOAD = "https://tailscale.com/download";

/** One card, one next step: what Tailscale does for sync and the single thing left to do. */
function TailscaleCard({ state, via }: { state: LanStatus["tailscale"]; via: LanStatus["via"] }) {
  if (state === "on") {
    return (
      <div className="card flex items-center gap-3 p-5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-primary text-sm font-semibold text-on-primary">✓</span>
        <span>
          <b className="block text-sm text-ink">Works anywhere</b>
          <small className="text-muted">
            {via === "tailscale" ? "Syncing through Tailscale right now." : "Tailscale is on, so sync keeps going when you leave this WiFi."}
          </small>
        </span>
      </div>
    );
  }
  if (state === "checking") {
    return (
      <div className="card p-5">
        <b className="block text-sm text-ink">Checking Tailscale...</b>
        <small className="text-muted">Your phone has Tailscale on. Seeing if this computer can reach it.</small>
      </div>
    );
  }
  const phoneHasIt = state === "phone";
  return (
    <div className="card flex flex-col gap-3 p-5">
      <span>
        <b className="block text-sm text-ink">{phoneHasIt ? "Turn on Tailscale here too" : "Sync away from home"}</b>
        <small className="text-muted">
          {phoneHasIt
            ? "Your phone has Tailscale on. Turn it on on this computer, signed in to the same account, and sync works anywhere."
            : "With Tailscale (free), sync keeps working when your phone and computer are on different networks."}
        </small>
      </span>
      {!phoneHasIt && (
        <ol className="flex flex-col gap-1 text-sm text-ink">
          <li>1. Get Tailscale on this computer and sign in</li>
          <li>2. In Curbox Sync on your phone, tap Get next to Tailscale, then sign in to the same account</li>
        </ol>
      )}
      <div className="flex items-center gap-3">
        <a className={btnOutline} href={TAILSCALE_DOWNLOAD} target="_blank" rel="noreferrer">
          {phoneHasIt ? "Open Tailscale download" : "Get Tailscale"}
        </a>
        <small className="text-faint">Nothing else to set up. I find it on my own.</small>
      </div>
    </div>
  );
}
