import { browser } from "#imports";
import type { KdfParams } from "../crypto";
import type { UsageHistory } from "../types";

const K_DEVICE_ID = "sync.deviceId";
const K_CURSOR = "sync.cursor";
const K_DEK = "sync.dek";
const K_VAULT = "sync.vaultMeta";
const K_REMOTE_USAGE = "sync.remoteUsage";
const K_REMOTE_USAGE_VIEW = "sync.remoteUsageView";

export interface VaultMeta {
  userId: string;
  saltB64: string;
  params: KdfParams;
  wrappedB64: string;
}

async function read<T>(key: string): Promise<T | null> {
  const res = await browser.storage.local.get(key);
  return (res[key] as T | undefined) ?? null;
}

async function write(key: string, value: unknown): Promise<void> {
  await browser.storage.local.set({ [key]: value });
}

export async function getDeviceId(): Promise<string> {
  let id = await read<string>(K_DEVICE_ID);
  if (!id) {
    id = crypto.randomUUID();
    await write(K_DEVICE_ID, id);
  }
  return id;
}

export const getCursor = () => read<string>(K_CURSOR);
export const setCursor = (cursor: string) => write(K_CURSOR, cursor);

export const getStoredDek = () => read<string>(K_DEK);
export const setStoredDek = (dekB64: string) => write(K_DEK, dekB64);

export const getVaultMeta = () => read<VaultMeta>(K_VAULT);
export const setVaultMeta = (meta: VaultMeta) => write(K_VAULT, meta);

export const getRemoteUsage = async (): Promise<UsageHistory> => (await read<UsageHistory>(K_REMOTE_USAGE)) ?? {};
export const setRemoteUsage = (usage: UsageHistory) => write(K_REMOTE_USAGE, usage);

export async function clearSyncState(): Promise<void> {
  await browser.storage.local.remove([K_CURSOR, K_DEK, K_VAULT, K_REMOTE_USAGE, K_REMOTE_USAGE_VIEW]);
}
