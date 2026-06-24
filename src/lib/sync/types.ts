// Shared sync vocabulary. Namespaces and payload shapes match the Android app.

export const NS_EXT_CONFIG = "ext_config";
export const NS_USAGE_WEB = "usage_web";
export const NS_FOCUS = "focus_state";
// Focus group definitions, shared across every platform (one last write wins
// record per group). A group made on any device shows up and can be started on
// all the others.
export const NS_FOCUS_GROUPS = "focus_groups";

// The cross platform shape of a single focus group. Both platforms serialise
// this with the exact key order below and sorted arrays so the bytes match and
// the echo suppression hashes line up. Mode is "only" or "all-except".
export interface FocusGroupPayload {
  id: string;
  name: string;
  mode: "only" | "all-except";
  exitable: boolean;
  autoTurnOnDnd: boolean;
  domains: string[];
  packages: string[];
}

// Canonical JSON. Key order and sorted arrays must stay identical to Android's
// PlaystoreSyncProvider.canonicalFocusGroupJson so a record made on one platform
// is recognised as unchanged on the other.
export function canonicalFocusGroupJson(p: FocusGroupPayload): string {
  return JSON.stringify({
    id: p.id,
    name: p.name,
    mode: p.mode,
    exitable: p.exitable,
    autoTurnOnDnd: p.autoTurnOnDnd,
    domains: [...p.domains].sort(),
    packages: [...p.packages].sort(),
  });
}

export interface SyncStatus {
  signedIn: boolean;
  email: string | null;
  hasVault: boolean; // a vault row exists on the server
  unlocked: boolean; // we hold the DEK locally
  deviceId: string | null;
  lastSync: number | null; // ms epoch of the last successful pull
  error: string | null;
  pendingEmail: string | null; // set when an emailed code is awaited
}

// One website usage record, per device per day per domain. Reading sums these
// across devices so a browser shows time spent on its sibling devices too.
export interface UsageWebPayload {
  date: string;
  domain: string;
  ms: number;
  paths?: Record<string, number>;
  platform: string;
}

// Messages the options page sends to the background sync engine.
export type SyncRequest =
  | { type: "sync:status" }
  | { type: "sync:signUp"; email: string; password: string }
  | { type: "sync:signIn"; email: string; password: string }
  | { type: "sync:verifyCode"; email: string; code: string }
  | { type: "sync:resendCode"; email: string }
  | { type: "sync:sendReset"; email: string }
  | { type: "sync:resetPassword"; email: string; code: string; password: string }
  | { type: "sync:signOut" }
  | { type: "sync:setPassphrase"; passphrase: string }
  | { type: "sync:unlock"; passphrase: string }
  | { type: "sync:makePairingCode" }
  | { type: "sync:pairWithCode"; payload: string };

export interface SyncResponse {
  ok: boolean;
  error?: string;
  status?: SyncStatus;
  pairingCode?: string;
}

export function isSyncRequest(msg: unknown): msg is SyncRequest {
  return (
    typeof msg === "object" &&
    msg !== null &&
    typeof (msg as { type?: unknown }).type === "string" &&
    (msg as { type: string }).type.startsWith("sync:")
  );
}
