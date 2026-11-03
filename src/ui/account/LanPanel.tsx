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

  // While unpaired, keep a code on screen and the background search running.
  useEffect(() => {
    if (paired !== false) return;
    let alive = true;
    void localAddressHint().then((hint) => alive && void send({ type: "lan:startPairing", hint }).then((r) => setStatus(r.status)));
    return () => {
      alive = false;
    };
  }, [paired]);

  useEffect(() => {
    if (!link) return setQr(null);
    void QRCode.toDataURL(link, { margin: 1, width: 240 }).then(setQr);
  }, [link]);

  if (!status) return <p className="text-sm text-muted">One moment...</p>;

  const header = (
    <div>
      <h1 className="font-display text-5xl text-ink">Phone over WiFi</h1>
      <p className="mt-1 text-sm text-muted">
        Keep focus mode in step with Curbox on your Android phone. Nothing leaves your home network.
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
  return (
    <div className="flex flex-col gap-5">
      {header}
      <div className="card flex flex-col gap-3 p-6">
        <p className="font-display text-3xl leading-none">{status.reachable ? "In step" : "Looking for your phone"}</p>
        <p className="text-sm text-muted">{status.address}</p>
        {phone?.connected && (
          <p className="text-sm text-ink">
            {phone.active ? `Phone focus: ${phone.name || "Focus"}, ${timeLeft(phone.endsAt)}` : "Focus is off on your phone"}
          </p>
        )}
        {(error ?? status.message) && <p className="text-sm text-muted">{error ?? status.message}</p>}
        <div className="flex gap-2">
          <button className={btnOutline} disabled={busy} onClick={() => void run({ type: "lan:syncNow" })}>
            Sync now
          </button>
          <button className={btnGhost} disabled={busy} onClick={() => void run({ type: "lan:unpair" })}>
            Unpair
          </button>
        </div>
      </div>
      <p className="text-xs text-faint">
        Focus groups are matched by name, so give a group the same name on both devices. Curbox Sync must stay on and both
        devices on the same WiFi.
      </p>
    </div>
  );
}
