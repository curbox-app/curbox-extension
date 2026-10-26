import type { KdfParams } from "../crypto";
import type { SyncCursor } from "./local";
import type { SyncBillingStatus } from "./types";

/**
 * Remote transport for sync. The engine already owns encryption, merge,
 * cursors, and local storage. A future backend only implements this contract,
 * then calls `registerSyncProvider` once before `getSyncEngine().start()`.
 */
export interface SyncIdentity {
  id: string;
  email: string | null;
}

export interface RemoteVault {
  saltB64: string;
  params: KdfParams;
  wrappedB64: string;
}

export interface RemoteDevice {
  id: string;
  platform: string;
  label: string | null;
  lastSeen: string | null;
}

export interface SyncRecord {
  id: string;
  namespace: string;
  recordKey: string;
  deviceId: string | null;
  ciphertext: string;
  version: number;
  deleted: boolean;
  updatedAt: string;
}

export interface SyncRecordWrite {
  userId: string;
  namespace: string;
  recordKey: string;
  deviceId: string;
  ciphertext: string;
  version: number;
  deleted: boolean;
}

export interface SyncProvider {
  readonly id: string;

  currentUser(): Promise<SyncIdentity | null>;
  /** Later sign-in and sign-out. Return an unsubscribe function. */
  onAuthChange(listener: (user: SyncIdentity | null) => void): () => void;

  signUp(email: string, password: string): Promise<{ pendingVerification: boolean }>;
  signIn(email: string, password: string): Promise<{ pendingVerification: boolean }>;
  verifyCode(email: string, code: string): Promise<void>;
  resendCode(email: string): Promise<void>;
  sendReset(email: string): Promise<void>;
  resetPassword(email: string, code: string, password: string): Promise<void>;
  signOut(): Promise<void>;

  fetchVault(userId: string): Promise<RemoteVault | null>;
  createVault(userId: string, vault: RemoteVault): Promise<void>;

  upsertDevice(input: { id: string; userId: string; platform: string; label: string; lastSeen: string }): Promise<void>;
  listDevices(userId: string): Promise<RemoteDevice[]>;
  renameDevice(userId: string, deviceId: string, label: string): Promise<void>;

  /** Listen for remote record changes. Resolve with an unsubscribe function. */
  subscribe(userId: string, onChange: () => void): Promise<() => void>;

  /**
   * One page of records, oldest first, ordered by updatedAt then id.
   * When `after` is null, include rows at or after `since` so a row that shares
   * the cursor timestamp but sorts earlier is not lost. When `after` is set,
   * return rows strictly after that pair. Return [] when there is nothing left.
   */
  pullPage(userId: string, query: { after: SyncCursor | null; since: SyncCursor; limit: number }): Promise<SyncRecord[]>;
  upsertRecord(record: SyncRecordWrite): Promise<void>;

  refreshEntitlement(userId: string): Promise<SyncBillingStatus>;
  billingUrl(userId: string, action: "checkout" | "manage"): Promise<string>;
}

let provider: SyncProvider | null = null;

export function registerSyncProvider(next: SyncProvider): void {
  provider = next;
}

export function getSyncProvider(): SyncProvider | null {
  return provider;
}
