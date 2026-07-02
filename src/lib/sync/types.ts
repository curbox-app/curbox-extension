export const NS_EXT_CONFIG = "ext_config";
export const NS_USAGE_WEB = "usage_web";
export const NS_FOCUS = "focus_state";
export const NS_FOCUS_GROUPS = "focus_groups";

export interface FocusGroupPayload {
  id: string;
  name: string;
  mode: "only" | "all-except";
  exitable: boolean;
  autoTurnOnDnd: boolean;
  domains: string[];
  packages: string[];
}

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
  hasVault: boolean;
  unlocked: boolean;
  deviceId: string | null;
  lastSync: number | null;
  error: string | null;
  pendingEmail: string | null;
}

export interface UsageWebPayload {
  date: string;
  platform: string;
  domains: Record<string, { ms: number; paths?: Record<string, number> }>;
}

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
