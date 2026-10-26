export const NS_EXT_CONFIG = "ext_config";
export const NS_USAGE_WEB = "usage_web";
export const NS_FOCUS = "focus_state";
export const NS_FOCUS_GROUPS = "focus_groups";
export const NO_SYNC_USAGE_DEVICE = "__curbox_no_sync_usage_device__";

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
  available: boolean;
  signedIn: boolean;
  email: string | null;
  hasVault: boolean;
  unlocked: boolean;
  deviceId: string | null;
  lastSync: number | null;
  error: string | null;
  pendingEmail: string | null;
  devices: SyncDevice[];
  preferences: SyncPreferences;
  billing: SyncBillingStatus;
}

export interface SyncBillingStatus {
  required: boolean;
  entitled: boolean;
  provider: string | null;
  price: string;
  validUntil: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface SyncDevice {
  id: string;
  platform: string;
  label: string;
  lastSeen: string | null;
  current: boolean;
}

export interface SyncPreferences {
  usageStats: boolean;
  reducerConfigs: boolean;
  usageDeviceIds: string[];
}

export const DEFAULT_SYNC_PREFERENCES: SyncPreferences = {
  usageStats: true,
  reducerConfigs: true,
  usageDeviceIds: [],
};

export const DEFAULT_SYNC_BILLING: SyncBillingStatus = {
  // Keep an options page from incorrectly paywalling during the few seconds in
  // which an extension update can still be talking to its older worker.
  required: false,
  entitled: true,
  provider: null,
  price: "$25/year",
  validUntil: null,
  cancelAtPeriodEnd: false,
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

/**
 * Runtime messages can briefly cross extension versions after an update: an
 * already-open options page may talk to an older background worker (or the
 * reverse). Keep that wire-format mismatch from crashing the account screen.
 */
export function normalizeSyncStatus(value: unknown): SyncStatus {
  const raw = record(value);
  const rawPreferences = record(raw.preferences);
  const rawBilling = record(raw.billing);
  const unlocked = raw.unlocked === true;
  const usageDeviceIds = Array.isArray(rawPreferences.usageDeviceIds)
    ? [...new Set(rawPreferences.usageDeviceIds.filter((id): id is string => typeof id === "string"))]
    : [];
  const devices = Array.isArray(raw.devices)
    ? raw.devices.flatMap((value): SyncDevice[] => {
        const device = record(value);
        if (typeof device.id !== "string") return [];
        const platform = typeof device.platform === "string" ? device.platform : "device";
        return [{
          id: device.id,
          platform,
          label: typeof device.label === "string" ? device.label : platform,
          lastSeen: nullableString(device.lastSeen),
          current: device.current === true,
        }];
      })
    : [];

  return {
    available: typeof raw.available === "boolean" ? raw.available : true,
    signedIn: unlocked || raw.signedIn === true,
    email: nullableString(raw.email),
    hasVault: unlocked || raw.hasVault === true,
    unlocked,
    deviceId: nullableString(raw.deviceId),
    lastSync: typeof raw.lastSync === "number" && Number.isFinite(raw.lastSync) ? raw.lastSync : null,
    error: nullableString(raw.error),
    pendingEmail: nullableString(raw.pendingEmail),
    devices,
    preferences: {
      usageStats: typeof rawPreferences.usageStats === "boolean"
        ? rawPreferences.usageStats
        : DEFAULT_SYNC_PREFERENCES.usageStats,
      reducerConfigs: typeof rawPreferences.reducerConfigs === "boolean"
        ? rawPreferences.reducerConfigs
        : DEFAULT_SYNC_PREFERENCES.reducerConfigs,
      usageDeviceIds,
    },
    billing: {
      required: typeof rawBilling.required === "boolean" ? rawBilling.required : DEFAULT_SYNC_BILLING.required,
      entitled: typeof rawBilling.entitled === "boolean" ? rawBilling.entitled : DEFAULT_SYNC_BILLING.entitled,
      provider: typeof rawBilling.provider === "string" && rawBilling.provider ? rawBilling.provider : null,
      price: typeof rawBilling.price === "string" ? rawBilling.price : DEFAULT_SYNC_BILLING.price,
      validUntil: nullableString(rawBilling.validUntil),
      cancelAtPeriodEnd: rawBilling.cancelAtPeriodEnd === true,
    },
  };
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
  | { type: "sync:pairWithCode"; payload: string }
  | { type: "sync:setDeviceName"; name: string }
  | { type: "sync:syncNow" }
  | { type: "sync:subscribe" }
  | { type: "sync:manageSubscription" }
  | { type: "sync:refreshEntitlement" }
  | { type: "sync:setPreferences"; preferences: SyncPreferences };

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
