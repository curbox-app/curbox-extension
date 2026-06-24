import { useState } from "react";
import QRCode from "qrcode";
import { useSync } from "./useSync";
import type { SyncStatus } from "../../lib/sync/types";

type Run = ReturnType<typeof useSync>["run"];
type Mode = "signin" | "signup" | "forgot" | "reset";

export function AccountPanel() {
  const { status, busy, error, run } = useSync();
  const [mode, setMode] = useState<Mode>("signin");
  const [resetEmail, setResetEmail] = useState("");

  if (!status) return <p className="text-sm text-muted">One moment...</p>;

  const shell = (children: React.ReactNode, title: string, subtitle: string) => (
    <div className="card flex flex-col gap-4 p-6">
      <div>
        <p className="font-display text-3xl leading-none">{title}</p>
        <p className="mt-2 text-sm text-muted">{subtitle}</p>
      </div>
      {error && <Banner text={error} />}
      {children}
    </div>
  );

  if (status.unlocked) return <Unlocked status={status} busy={busy} run={run} />;
  if (status.signedIn) return <Passphrase status={status} busy={busy} error={error} run={run} />;

  if (status.pendingEmail) {
    return shell(
      <Verify email={status.pendingEmail} busy={busy} run={run} />,
      "Check your email",
      `I sent a code to ${status.pendingEmail}. Type it below to finish setting up.`,
    );
  }
  if (mode === "forgot") {
    return shell(
      <Forgot busy={busy} run={run} onSent={(e) => { setResetEmail(e); setMode("reset"); }} onBack={() => setMode("signin")} />,
      "Reset password",
      "Tell me your email and I will send you a code to set a new password.",
    );
  }
  if (mode === "reset") {
    return shell(
      <Reset email={resetEmail} busy={busy} run={run} />,
      "Choose a new password",
      "Type the code I emailed you and your new password.",
    );
  }
  return shell(
    <SignIn mode={mode} busy={busy} run={run} onMode={setMode} />,
    mode === "signup" ? "Create your account" : "Sync across my devices",
    mode === "signup"
      ? "Make an account so your settings and stats can travel with you."
      : "I keep your settings and time stats in step on every browser and phone, locked with a key only you hold.",
  );
}

function Banner({ text }: { text: string }) {
  return <p className="rounded-lg bg-surface-2 px-3 py-2 text-sm text-red-600">{text}</p>;
}

function Field(props: {
  label: string;
  type?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="label">{props.label}</span>
      <input
        type={props.type ?? "text"}
        value={props.value}
        placeholder={props.placeholder}
        onChange={(e) => props.onChange(e.target.value)}
        className="rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-sm text-ink outline-none focus:border-ink"
      />
    </label>
  );
}

function Btn(props: { onClick: () => void; busy?: boolean; children: React.ReactNode; ghost?: boolean }) {
  return (
    <button
      onClick={props.onClick}
      disabled={props.busy}
      className={`rounded-lg px-4 py-2.5 text-sm font-medium transition-colors disabled:opacity-50 ${
        props.ghost ? "text-muted hover:text-ink" : "bg-ink text-surface"
      }`}
    >
      {props.children}
    </button>
  );
}

function Link({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="text-sm font-medium text-ink underline-offset-2 hover:underline">
      {children}
    </button>
  );
}

function SignIn({ mode, busy, run, onMode }: { mode: Mode; busy: boolean; run: Run; onMode: (m: Mode) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const signup = mode === "signup";
  return (
    <>
      <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <Field label="Password" type="password" value={password} onChange={setPassword} />
      <Btn busy={busy} onClick={() => void run({ type: signup ? "sync:signUp" : "sync:signIn", email, password })}>
        {signup ? "Create account" : "Sign in"}
      </Btn>
      <div className="flex items-center justify-between">
        {!signup && <Link onClick={() => onMode("forgot")}>Forgot password?</Link>}
        <span className="ml-auto text-sm text-muted">
          {signup ? "Already have an account? " : "New here? "}
          <Link onClick={() => onMode(signup ? "signin" : "signup")}>{signup ? "Sign in" : "Create one"}</Link>
        </span>
      </div>
    </>
  );
}

function Verify({ email, busy, run }: { email: string; busy: boolean; run: Run }) {
  const [code, setCode] = useState("");
  return (
    <>
      <Field label="Email code" value={code} onChange={setCode} placeholder="Paste the code" />
      <Btn busy={busy} onClick={() => void run({ type: "sync:verifyCode", email, code })}>
        Verify and continue
      </Btn>
      <Btn ghost busy={busy} onClick={() => void run({ type: "sync:resendCode", email })}>
        Send a new code
      </Btn>
    </>
  );
}

function Forgot({
  busy,
  run,
  onSent,
  onBack,
}: {
  busy: boolean;
  run: Run;
  onSent: (email: string) => void;
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  return (
    <>
      <Field label="Email" type="email" value={email} onChange={setEmail} placeholder="you@example.com" />
      <Btn
        busy={busy}
        onClick={async () => {
          const res = await run({ type: "sync:sendReset", email });
          if (res.ok) onSent(email);
        }}
      >
        Send reset code
      </Btn>
      <Btn ghost busy={busy} onClick={onBack}>
        Back to sign in
      </Btn>
    </>
  );
}

function Reset({ email, busy, run }: { email: string; busy: boolean; run: Run }) {
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  return (
    <>
      <Field label="Email code" value={code} onChange={setCode} placeholder="Paste the code" />
      <Field label="New password" type="password" value={password} onChange={setPassword} />
      <Btn busy={busy} onClick={() => void run({ type: "sync:resetPassword", email, code, password })}>
        Set new password
      </Btn>
    </>
  );
}

function Passphrase({
  status,
  busy,
  error,
  run,
}: {
  status: SyncStatus;
  busy: boolean;
  error: string | null;
  run: Run;
}) {
  const [passphrase, setPassphrase] = useState("");
  const [code, setCode] = useState("");
  const hasVault = status.hasVault;
  return (
    <div className="card flex flex-col gap-4 p-6">
      <div>
        <p className="font-display text-3xl leading-none">{hasVault ? "Unlock my data" : "Make a secret phrase"}</p>
        <p className="mt-2 text-sm text-muted">
          {hasVault
            ? "Type the secret phrase you made on your first device. Or paste a pairing code below to skip typing it."
            : "This one phrase unlocks your data on every device. I never send it anywhere, so pick something you will remember and keep it safe. If you forget it, your data cannot be opened again."}
        </p>
      </div>
      {error && <Banner text={error} />}
      <Field label="Secret phrase" type="password" value={passphrase} onChange={setPassphrase} />
      <Btn
        busy={busy || passphrase.length < 8}
        onClick={() => void run({ type: hasVault ? "sync:unlock" : "sync:setPassphrase", passphrase })}
      >
        {hasVault ? "Unlock" : "Turn on sync"}
      </Btn>

      {/* Pairing only makes sense once a vault exists on another device. On the
          first device there is nothing to pair with, so it stays hidden. */}
      {hasVault && (
        <div className="border-t border-line pt-4">
          <p className="label mb-2">Or paste a pairing code</p>
          <p className="mb-2 text-xs text-muted">
            Open Sync on a device that already works, show its code, and paste it here. No typing your phrase.
          </p>
          <textarea
            value={code}
            onChange={(e) => setCode(e.target.value)}
            rows={3}
            className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 font-mono text-xs text-ink outline-none focus:border-ink"
          />
          <div className="mt-2">
            <Btn ghost busy={busy} onClick={() => void run({ type: "sync:pairWithCode", payload: code })}>
              Use pairing code
            </Btn>
          </div>
        </div>
      )}
      <Btn ghost busy={busy} onClick={() => void run({ type: "sync:signOut" })}>
        Sign out
      </Btn>
    </div>
  );
}

function Unlocked({ status, busy, run }: { status: SyncStatus; busy: boolean; run: Run }) {
  const [qr, setQr] = useState<string | null>(null);

  const showCode = async () => {
    const res = await run({ type: "sync:makePairingCode" });
    if (res.pairingCode) setQr(await QRCode.toDataURL(res.pairingCode, { margin: 1, width: 220 }));
    setTimeout(() => setQr(null), 60000);
  };

  return (
    <div className="card flex flex-col gap-4 p-6">
      <div className="flex items-center gap-2.5">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <p className="font-display text-3xl leading-none">Sync is on</p>
      </div>
      <p className="text-sm text-muted">{status.email}</p>
      <p className="text-xs text-muted">
        {status.lastSync ? `Last synced ${new Date(status.lastSync).toLocaleTimeString()}` : "Waiting for first sync"}
        {status.error ? ` · ${status.error}` : ""}
      </p>

      <div className="border-t border-line pt-4">
        <p className="label mb-2">Add another device</p>
        <p className="mb-3 text-xs text-muted">
          Scan this on your phone or another browser to bring it in without typing your phrase. Anyone who sees this
          can read your data, so only show it to your own devices.
        </p>
        {qr ? (
          <img src={qr} alt="Pairing code" className="rounded-lg border border-line" />
        ) : (
          <Btn ghost busy={busy} onClick={() => void showCode()}>
            Show pairing code
          </Btn>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <Btn ghost busy={busy} onClick={() => void run({ type: "sync:signOut" })}>
          Sign out of this device
        </Btn>
      </div>
    </div>
  );
}
