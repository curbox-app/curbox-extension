import { useCallback, useEffect, useState } from "react";
import QRCode from "qrcode";
import { browser } from "#imports";
import { btnGhost, btnOutline, inputCls } from "../components";
import type { LanRequest, LanResponse, LanStatus } from "../../lib/lan/engine";

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

export function LanPanel() {
  const [status, setStatus] = useState<LanStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [address, setAddress] = useState("");
  const [code, setCode] = useState("");
  const [manual, setManual] = useState(false);
  const [qr, setQr] = useState<string | null>(null);
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

  const paired = status?.paired;
  const link = status?.pairingLink ?? null;
  const [hint, setHint] = useState<string | null | undefined>(undefined);

  // This computer's address tells the background which network it is on now.
  useEffect(() => {
    void localAddressHint().then((h) => {
      setHint(h);
      if (h) void send({ type: "lan:hint", hint: h });
    });
  }, []);

  const addNetwork = () => void run({ type: "lan:startPairing", hint: hint ?? null, adding: true });

  // While unpaired, keep a code on screen and the background search running.
  useEffect(() => {
    if (paired !== false || hint === undefined) return;
    void send({ type: "lan:startPairing", hint }).then((r) => setStatus(r.status));
  }, [paired, hint]);

  useEffect(() => {
    if (!link) return setQr(null);
    void QRCode.toDataURL(link, { margin: 1, width: 240 }).then(setQr);
  }, [link]);

  if (!status) return <p className="text-sm text-muted">One moment...</p>;

  const header = (
    <div>
      <h1 className="font-display text-5xl text-ink">Phone over WiFi</h1>
      <p className="mt-1 text-sm text-muted">
        Keep focus mode in step with Curbox on your Android phone, and see both devices' time together in Curbox Sync. Nothing
        leaves your WiFi.
      </p>
    </div>
  );

  if (!status.paired) {
    return (
      <div className="flex flex-col gap-5">
        {header}
        <div className="card flex flex-col items-center gap-4 p-6 text-center">
          <p className="text-sm text-muted">
            Open Curbox Sync on your phone and tap Scan browser code. Keep both on the same WiFi.
          </p>
          {qr ? (
            <img src={qr} alt="Pairing code for Curbox Sync" className="w-56 rounded-xl bg-white p-2" />
          ) : (
            <div className="h-56 w-56 rounded-xl bg-surface-2" />
          )}
          <p className="text-sm text-ink">{status.pairingLink ? "Looking for your phone..." : "Getting a code ready..."}</p>
          {error && <p className="text-sm text-ink">{error}</p>}
        </div>
        {!manual ? (
          <button className={btnGhost} onClick={() => setManual(true)}>
            Type the address and code instead
          </button>
        ) : (
          <div className="card flex flex-col gap-3 p-6">
            <p className="label">Phone address</p>
            <input className={inputCls} placeholder="192.168.1.20:47621" value={address} onChange={(e) => setAddress(e.target.value)} />
            <p className="label">Pairing code</p>
            <input
              className={`${inputCls} font-mono uppercase tracking-widest`}
              placeholder="ABCD EFGH JKLM"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <button
              className={btnOutline}
              disabled={busy || !address.trim() || !code.trim()}
              onClick={() => void run({ type: "lan:pair", address, code }).then((r) => r.ok && setCode(""))}
            >
              {busy ? "Pairing..." : "Pair"}
            </button>
          </div>
        )}
      </div>
    );
  }

  const phone = status.phone;
  const here = status.places.find((p) => p.id === status.placeId);
  return (
    <div className="flex flex-col gap-5">
      {header}
      {status.adding && (
        <div className="card flex flex-col items-center gap-4 p-6 text-center">
          <p className="font-display text-3xl leading-none">Add this network</p>
          <p className="text-sm text-muted">
            Join this WiFi on your phone, open Curbox Sync and tap Scan browser code. Your other networks stay saved.
          </p>
          {qr ? (
            <img src={qr} alt="Code to add this network in Curbox Sync" className="w-56 rounded-xl bg-white p-2" />
          ) : (
            <div className="h-56 w-56 rounded-xl bg-surface-2" />
          )}
          <p className="text-sm text-ink">Looking for your phone on this WiFi...</p>
          <button className={btnGhost} onClick={() => void run({ type: "lan:cancelPairing" })}>
            Cancel
          </button>
        </div>
      )}
      <div className="card flex flex-col gap-3 p-6">
        <p className="font-display text-3xl leading-none">{status.reachable ? "In step" : "Looking for your phone"}</p>
        {status.lastOkAt > 0 && <p className="text-sm text-ink">Last synced {ago(status.lastOkAt)}</p>}
        <p className="text-sm text-muted">{here ? `${here.label} · ${status.address}` : status.address}</p>
        {phone?.connected && (
          <p className="text-sm text-ink">
            {phone.active ? `Phone focus: ${phone.name || "Focus"}, ${timeLeft(phone.endsAt)}` : "Focus is off on your phone"}
          </p>
        )}
        {(error ?? status.message) && <p className="text-sm text-muted">{error ?? status.message}</p>}
        <div className="flex flex-wrap gap-2">
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
          {!status.adding && (
            <button className={status.reachable ? btnGhost : btnOutline} disabled={busy} onClick={addNetwork}>
              Add this network
            </button>
          )}
          <button className={btnGhost} disabled={busy} onClick={() => void run({ type: "lan:unpair" })}>
            Unpair
          </button>
        </div>
      </div>
      {status.places.length > 0 && (
        <div className="flex flex-col gap-1">
          <p className="label px-1">Saved networks</p>
          {status.places.map((p) => (
            <div key={p.id} className="flex items-center gap-3 rounded-xl px-1 py-2">
              <span className="flex-1">
                <b className="block text-sm text-ink">{p.label || "WiFi"}</b>
                <small className="text-muted">
                  {p.address.split(":")[0]} · {p.id === status.placeId ? "here now" : `last met ${ago(p.lastOkAt)}`}
                </small>
              </span>
              <button className={btnGhost} disabled={busy} onClick={() => void run({ type: "lan:forgetPlace", id: p.id })}>
                Forget
              </button>
            </div>
          ))}
        </div>
      )}
      {status.usageSentAt > 0 && status.usageSentAt <= Date.now() && (
        <p className="text-sm text-muted">Site time shared with your phone {ago(status.usageSentAt)}.</p>
      )}
      <p className="text-xs text-faint">
        Focus groups are matched by name, so give a group the same name on both devices. On a saved WiFi I find your phone on
        my own. On a new one, tap Add this network. Rename networks in Curbox Sync.
      </p>
    </div>
  );
}
