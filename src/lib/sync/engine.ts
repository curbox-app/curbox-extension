import { browser } from "#imports";
import {
  decryptRecord,
  deriveKEK,
  encryptRecord,
  fromBase64Url,
  importDEK,
  randomDEK,
  randomSalt,
  recordAad,
  toBase64Url,
  unwrapDEK,
  wrapDEK,
  DEFAULT_KDF_PARAMS,
  buildPairingPayload,
  parsePairingPayload,
} from "../crypto";
import { dateKey, lastNDays } from "../time";
import { RETENTION_DAYS } from "../usage-data";
import { get, getUsage, isApplyingRemote, isUsageKey, setFromRemote, watch } from "../storage";
import type { FocusGroup, FocusMode, FocusSession, Settings, UsageHistory } from "../types";
import { normalizeSettings } from "../types";
import {
  clearSyncState,
  getCursor,
  getDeviceId,
  getKnownFocusGroupIds,
  getRemoteUsage,
  getSyncPreferences,
  getStoredDek,
  getVaultMeta,
  setCursor,
  setKnownFocusGroupIds,
  setRemoteUsage,
  setSyncPreferences,
  setStoredDek,
  setVaultMeta,
  type SyncCursor,
  type VaultMeta,
} from "./local";
import {
  canonicalFocusGroupJson,
  NO_SYNC_USAGE_DEVICE,
  NS_EXT_CONFIG,
  NS_FOCUS,
  NS_FOCUS_GROUPS,
  NS_USAGE_WEB,
  type FocusGroupPayload,
  DEFAULT_SYNC_BILLING,
  type SyncStatus,
  type SyncBillingStatus,
  type SyncDevice,
  type SyncPreferences,
  type UsageWebPayload,
} from "./types";
import { getSyncProvider, type SyncProvider, type SyncRecord } from "./provider";

const PLATFORM = "ext";
const PUSH_DEBOUNCE_MS = 1500;

interface SyncRow {
  id: string;
  namespace: string;
  record_key: string;
  device_id: string | null;
  ciphertext: string;
  version: number;
  deleted: boolean;
  updated_at: string;
}

export class SyncEngine {
  private dek: CryptoKey | null = null;
  private dekBytes: Uint8Array | null = null;
  private userId: string | null = null;
  private email: string | null = null;
  private deviceId: string | null = null;
  private unsubscribeAuth: (() => void) | null = null;
  private unsubscribeRemote: (() => void) | null = null;
  private configPushTimer: ReturnType<typeof setTimeout> | null = null;
  private usagePushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConfigJson: string | null = null; // echo suppression for config
  private lastFocusJson: string | null = null; // echo suppression for focus
  private usageShadows = new Map<string, string>(); // canonical JSON per retained local day
  // Last synced canonical JSON per focus group id, so we only push real changes
  // and never bounce an applied remote group straight back up.
  private focusGroupShadow = new Map<string, string>();
  private knownFocusGroupIds = new Set<string>();
  private lastSync: number | null = null;
  private lastError: string | null = null;
  private pendingEmail: string | null = null;
  private starting = false;
  private preferences: SyncPreferences = { usageStats: true, reducerConfigs: true, usageDeviceIds: [] };
  private devices: SyncDevice[] = [];
  private pullQueue: Promise<void> = Promise.resolve();
  private signedInInit: Promise<void> | null = null;
  private billing: SyncBillingStatus = { ...DEFAULT_SYNC_BILLING, entitled: false };

  private provider(): SyncProvider {
    const provider = getSyncProvider();
    if (!provider) throw new Error("Sync is not connected");
    return provider;
  }

  private rememberUser(user: { id: string; email: string | null } | null): void {
    this.userId = user?.id ?? null;
    this.email = user?.email ?? null;
  }

  async start(): Promise<void> {
    if (this.starting || !getSyncProvider()) return;
    this.starting = true;
    this.deviceId = await getDeviceId();
    this.preferences = await getSyncPreferences();

    this.unsubscribeAuth = this.provider().onAuthChange((user) => {
      this.rememberUser(user);
      if (this.userId) void this.onSignedIn().catch((err) => this.recordError(err));
      else void this.teardown();
    });

    this.rememberUser(await this.provider().currentUser());
    if (this.userId) await this.onSignedIn();

    watch((changed) => {
      if (isApplyingRemote()) return;
      if ("settings" in changed) this.scheduleConfigPush();
      if (Object.keys(changed).some(isUsageKey)) this.scheduleUsagePush();
      if ("focus" in changed) void this.pushFocus().catch((err) => this.recordError(err));
    });
  }

  private async onSignedIn(): Promise<void> {
    if (this.signedInInit) return this.signedInInit;
    const run = this.initializeSignedIn();
    this.signedInInit = run;
    try {
      await run;
    } finally {
      if (this.signedInInit === run) this.signedInInit = null;
    }
  }

  private async initializeSignedIn(): Promise<void> {
    await this.refreshEntitlement();
    if (!this.billing.entitled) {
      await this.stopSyncNetwork();
      return;
    }
    const localVault = await getVaultMeta();
    if (localVault && localVault.userId !== this.userId) {
      // A browser profile can authenticate a different account without the old
      // session completing its sign-out callback. Never reuse that account's
      // device identity, key envelope, cursor, or decrypted usage cache.
      await clearSyncState();
      this.deviceId = null;
      this.dek = null;
      this.dekBytes = null;
      this.lastConfigJson = null;
      this.lastFocusJson = null;
      this.usageShadows.clear();
      this.focusGroupShadow.clear();
      this.knownFocusGroupIds.clear();
      this.preferences = await getSyncPreferences();
    }
    if (!this.deviceId) this.deviceId = await getDeviceId();
    const stored = await getStoredDek();
    if (stored) {
      this.dekBytes = fromBase64Url(stored);
      this.dek = await importDEK(this.dekBytes);
    }
    await this.registerDevice();
    await this.refreshDevices();
    this.knownFocusGroupIds = new Set(await getKnownFocusGroupIds());
    if (this.dek) {
      await this.subscribe();
      await this.pullSinceCursor();
      await this.pushConfig();
      await this.pushFocusGroups();
      await this.pushUsage();
      await this.pushFocus();
    }
  }

  private async teardown(): Promise<void> {
    await this.stopSyncNetwork();
    this.billing = { ...this.billing, entitled: false, provider: null, validUntil: null, cancelAtPeriodEnd: false };
    this.dek = null;
    this.dekBytes = null;
  }

  private async stopSyncNetwork(): Promise<void> {
    if (this.configPushTimer) clearTimeout(this.configPushTimer);
    if (this.usagePushTimer) clearTimeout(this.usagePushTimer);
    this.configPushTimer = null;
    this.usagePushTimer = null;
    if (this.unsubscribeRemote) {
      this.unsubscribeRemote();
      this.unsubscribeRemote = null;
    }
  }

  async refreshEntitlement(): Promise<void> {
    if (!getSyncProvider() || !this.userId) {
      this.billing = { ...this.billing, entitled: false, provider: null, validUntil: null, cancelAtPeriodEnd: false };
      return;
    }
    const wasEntitled = this.billing.entitled;
    const result = await this.provider().refreshEntitlement(this.userId);
    this.billing = {
      required: result.required === true,
      entitled: result.entitled === true,
      provider: typeof result.provider === "string" && result.provider ? result.provider : null,
      price: typeof result.price === "string" ? result.price : this.billing.price,
      validUntil: typeof result.validUntil === "string" ? result.validUntil : null,
      cancelAtPeriodEnd: result.cancelAtPeriodEnd === true,
    };
    if (wasEntitled && !this.billing.entitled) await this.stopSyncNetwork();
    if (!wasEntitled && this.billing.entitled && !this.signedInInit) await this.onSignedIn();
  }

  async billingUrl(action: "checkout" | "manage"): Promise<string> {
    if (!this.userId) throw new Error("sign in first");
    const url = await this.provider().billingUrl(this.userId, action === "manage" ? "manage" : "checkout");
    if (!url.startsWith("https://")) throw new Error("billing did not return a safe checkout link");
    return url;
  }

  private requirePremium(): void {
    if (!this.billing.entitled) throw new Error("Sync Premium is required");
  }

  // Auth -----------------------------------------------------------------

  async signUp(email: string, password: string): Promise<void> {
    const result = await this.provider().signUp(email, password);
    if (result.pendingVerification) this.pendingEmail = email;
  }

  async signIn(email: string, password: string): Promise<void> {
    const result = await this.provider().signIn(email, password);
    if (result.pendingVerification) this.pendingEmail = email;
  }

  async verifyCode(email: string, code: string): Promise<void> {
    await this.provider().verifyCode(email, code);
    this.pendingEmail = null;
  }

  async resendCode(email: string): Promise<void> {
    await this.provider().resendCode(email);
  }

  async sendReset(email: string): Promise<void> {
    await this.provider().sendReset(email);
  }

  async resetPassword(email: string, code: string, password: string): Promise<void> {
    await this.provider().resetPassword(email, code, password);
    this.pendingEmail = null;
  }

  async signOut(): Promise<void> {
    await this.provider().signOut();
    // Let an already-running pull finish before clearing so it cannot restore
    // decrypted cache entries after the account has been removed locally.
    await this.pullQueue.catch(() => undefined);
    await clearSyncState();
    this.lastConfigJson = null;
    this.lastFocusJson = null;
    this.usageShadows.clear();
    this.focusGroupShadow.clear();
    this.knownFocusGroupIds.clear();
    this.deviceId = null;
    this.devices = [];
    this.email = null;
    this.preferences = { ...this.preferences, usageDeviceIds: [] };
    this.lastSync = null;
    this.lastError = null;
    this.pendingEmail = null;
  }

  // Vault and unlocking --------------------------------------------------

  private async fetchVault(): Promise<VaultMeta | null> {
    if (!this.userId) return null;
    this.requirePremium();
    const vault = await this.provider().fetchVault(this.userId);
    if (!vault) return null;
    return { userId: this.userId, ...vault };
  }

  // First time setup: generate a fresh data key, wrap it under the passphrase,
  // and store the envelope on the server.
  async setPassphrase(passphrase: string): Promise<void> {
    if (!this.userId) throw new Error("sign in first");
    this.requirePremium();
    if (passphrase.length < 8) throw new Error("use at least 8 characters for the secret phrase");
    if (passphrase.length > 1024) throw new Error("secret phrase is too long");
    const existing = await this.fetchVault();
    if (existing) throw new Error("a passphrase already exists, unlock instead");

    const salt = randomSalt();
    const kek = await deriveKEK(passphrase, salt, DEFAULT_KDF_PARAMS);
    const dekBytes = randomDEK();
    const wrapped = await wrapDEK(kek, dekBytes, this.userId);

    const meta: VaultMeta = {
      userId: this.userId,
      saltB64: toBase64Url(salt),
      params: DEFAULT_KDF_PARAMS,
      wrappedB64: toBase64Url(wrapped),
    };
    await this.provider().createVault(this.userId, {
      saltB64: meta.saltB64,
      params: meta.params,
      wrappedB64: meta.wrappedB64,
    });

    await this.adoptDek(dekBytes, meta);
    await this.onSignedIn();
  }

  async unlock(passphrase: string): Promise<void> {
    if (!this.userId) throw new Error("sign in first");
    this.requirePremium();
    if (passphrase.length > 1024) throw new Error("secret phrase is too long");
    const meta = (await this.fetchVault()) ?? (await getVaultMeta());
    if (!meta) throw new Error("no passphrase set yet");
    const kek = await deriveKEK(passphrase, fromBase64Url(meta.saltB64), meta.params);
    let dekBytes: Uint8Array;
    try {
      dekBytes = await unwrapDEK(kek, fromBase64Url(meta.wrappedB64), this.userId);
    } catch {
      throw new Error("that passphrase did not work");
    }
    await this.adoptDek(dekBytes, meta);
    await this.onSignedIn();
  }

  async makePairingCode(): Promise<string> {
    this.requirePremium();
    if (!this.userId || !this.dekBytes) throw new Error("unlock first");
    return buildPairingPayload(this.userId, this.dekBytes);
  }

  async pairWithCode(payload: string): Promise<void> {
    if (!this.userId) throw new Error("sign in first");
    this.requirePremium();
    const { userId, dek } = parsePairingPayload(payload);
    if (userId !== this.userId) throw new Error("this code is for a different account");
    const meta = (await this.fetchVault()) ?? (await getVaultMeta());
    if (meta) await setVaultMeta(meta);
    await this.adoptDek(dek, meta ?? undefined);
    await this.onSignedIn();
  }

  private async adoptDek(dekBytes: Uint8Array, meta?: VaultMeta): Promise<void> {
    this.dekBytes = dekBytes;
    this.dek = await importDEK(dekBytes);
    await setStoredDek(toBase64Url(dekBytes));
    if (meta) await setVaultMeta(meta);
  }

  // Devices --------------------------------------------------------------

  private async registerDevice(): Promise<void> {
    if (!this.billing.entitled) return;
    if (!this.userId || !this.deviceId) return;
    await this.provider().upsertDevice({
      id: this.deviceId,
      userId: this.userId,
      platform: `${PLATFORM}-${this.browserLabel()}`,
      label: this.browserLabel(),
      lastSeen: new Date().toISOString(),
    });
  }

  private async refreshDevices(): Promise<void> {
    if (!this.billing.entitled) return;
    if (!this.userId) return;
    const devices = await this.provider().listDevices(this.userId);
    this.devices = devices.map((d) => ({
      id: d.id,
      platform: d.platform,
      label: (d.label || d.platform || "Device").trim(),
      lastSeen: d.lastSeen,
      current: d.id === this.deviceId,
    }));
  }

  async setDeviceName(name: string): Promise<void> {
    this.requirePremium();
    const label = name.trim().slice(0, 60);
    if (!label || !this.userId || !this.deviceId) throw new Error("Enter a device name");
    await this.provider().renameDevice(this.userId, this.deviceId, label);
    await this.refreshDevices();
  }

  async setPreferences(preferences: SyncPreferences): Promise<void> {
    this.requirePremium();
    const requestedIds = [...new Set(preferences.usageDeviceIds)].filter((id) => id !== this.deviceId);
    this.preferences = {
      ...preferences,
      usageDeviceIds: requestedIds.includes(NO_SYNC_USAGE_DEVICE) ? [NO_SYNC_USAGE_DEVICE] : requestedIds,
    };
    await setSyncPreferences(this.preferences);
    await setCursor({ updatedAt: "1970-01-01T00:00:00Z", id: "" });
    // Rebuild from the server so devices just excluded cannot remain in the
    // local aggregate from an earlier selection.
    await setRemoteUsage({});
    await browser.storage.local.set({ "sync.remoteUsageView": {} });
    await this.pullSinceCursor();
    if (this.preferences.reducerConfigs) { await this.pushConfig(); await this.pushFocusGroups(); await this.pushFocus(); }
    if (this.preferences.usageStats) await this.pushUsage();
  }

  private browserLabel(): string {
    return navigator.userAgent.includes("Firefox") ? "firefox" : "chrome";
  }

  // Realtime -------------------------------------------------------------

  private async subscribe(): Promise<void> {
    if (this.unsubscribeRemote || !this.userId || !this.billing.entitled) return;
    this.unsubscribeRemote = await this.provider().subscribe(this.userId, () => {
      void this.pullSinceCursor().catch(() => undefined);
    });
  }

  // Pull -----------------------------------------------------------------

  async pullSinceCursor(): Promise<void> {
    if (!this.billing.entitled) return;
    const run = this.pullQueue.catch(() => undefined).then(() => this.pullSinceCursorLocked());
    this.pullQueue = run;
    try {
      await run;
    } catch (err) {
      this.recordError(err);
      throw err;
    }
  }

  private async pullSinceCursorLocked(): Promise<void> {
    if (!this.dek || !this.userId) return;
    const cursor = await getCursor();
    let after: SyncCursor | null = null;
    let maxCursor = cursor;
    let foundRows = false;
    let configRow: SyncRow | null = null;
    let focusRow: SyncRow | null = null;
    const focusGroupRows: SyncRow[] = [];
    const remoteUsage = await getRemoteUsage();
    let usageChanged = false;

    for (;;) {
      const page = await this.provider().pullPage(this.userId, { after, since: cursor, limit: 500 });
      const rows = page.map((record) => this.toSyncRow(record));
      if (rows.length === 0) break;
      foundRows = true;

      for (const row of rows) {
        this.validateRow(row);
        if (this.preferences.reducerConfigs && !row.deleted && row.namespace === NS_EXT_CONFIG && row.device_id !== this.deviceId) {
          configRow = row;
        } else if (this.preferences.reducerConfigs && !row.deleted && row.namespace === NS_FOCUS && row.device_id !== this.deviceId) {
          focusRow = row;
        } else if (this.preferences.reducerConfigs && row.namespace === NS_FOCUS_GROUPS && row.device_id !== this.deviceId) {
          if (focusGroupRows.length >= 5000) throw new Error("sync data is too large");
          focusGroupRows.push(row);
        } else if (this.preferences.usageStats && row.namespace === NS_USAGE_WEB && this.selectedRemoteDevice(row.device_id)) {
          if (await this.applyUsageRow(row, remoteUsage)) usageChanged = true;
        }
        maxCursor = { updatedAt: row.updated_at, id: row.id };
      }
      const last = rows[rows.length - 1]!;
      after = { updatedAt: last.updated_at, id: last.id };
      if (rows.length < 500) break;
    }

    if (!foundRows) {
      this.lastSync = Date.now();
      this.lastError = null;
      return;
    }
    if (focusGroupRows.length) await this.applyFocusGroupRows(focusGroupRows);
    if (configRow) await this.applyConfigRow(configRow);
    if (focusRow) await this.applyFocusRow(focusRow);
    if (usageChanged) {
      this.pruneOldUsage(remoteUsage);
      await setRemoteUsage(remoteUsage);
      await this.publishRemoteUsage(remoteUsage);
    }
    await setCursor(maxCursor);
    this.lastSync = Date.now();
    this.lastError = null;
  }

  private selectedRemoteDevice(deviceId: string | null): boolean {
    if (!deviceId || deviceId === this.deviceId) return false;
    const selected = this.preferences.usageDeviceIds;
    if (selected.includes(NO_SYNC_USAGE_DEVICE)) return false;
    return selected.length === 0 || selected.includes(deviceId);
  }

  private validateRow(row: SyncRow): void {
    if (!row.id || !row.namespace || !row.record_key || !row.updated_at) throw new Error("invalid sync row");
    if (row.record_key.length > 1100 || row.ciphertext.length > 3_000_000) throw new Error("sync data is too large");
  }

  // Config is per platform and deliberately excludes focus groups, which travel
  // cross platform through their own namespace. Stripping them here keeps the two
  // sync paths from fighting over the same data.
  private configJson(settings: Settings): string {
    return JSON.stringify({ ...normalizeSettings(settings), focusGroups: [] });
  }

  private async applyConfigRow(row: SyncRow): Promise<void> {
    if (!this.dek || !this.userId) return;
    const aad = recordAad(this.userId, NS_EXT_CONFIG, row.record_key);
    const json = await decryptRecord(this.dek, aad, fromBase64Url(row.ciphertext));
    if (json.length > 5_000_000) throw new Error("sync config is too large");
    const remote = normalizeSettings(JSON.parse(json));
    const local = await get("settings");
    const canonical = this.configJson(remote);
    if (this.configJson(local) === canonical) {
      this.lastConfigJson = canonical;
      return;
    }
    // Keep our own focus groups; the config payload no longer carries them.
    await setFromRemote("settings", { ...remote, focusGroups: local.focusGroups });
    this.lastConfigJson = canonical;
  }

  // Focus groups (cross platform) ---------------------------------------

  private toFocusPayload(g: FocusGroup): FocusGroupPayload {
    return {
      id: g.id,
      name: g.name,
      mode: g.mode === "all-except" ? "all-except" : "only",
      exitable: g.exitable,
      autoTurnOnDnd: g.autoTurnOnDnd ?? false,
      domains: g.domains ?? [],
      packages: g.packages ?? [],
    };
  }

  private fromFocusPayload(p: FocusGroupPayload): FocusGroup {
    return {
      id: p.id,
      name: p.name || "Focus",
      domains: p.domains ?? [],
      mode: p.mode === "all-except" ? "all-except" : "only-these",
      exitable: p.exitable ?? true,
      packages: p.packages ?? [],
      autoTurnOnDnd: p.autoTurnOnDnd ?? false,
    };
  }

  async pushFocusGroups(): Promise<void> {
    if (!this.billing.entitled) return;
    if (!this.preferences.reducerConfigs) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const settings = await get("settings");
    const groups = settings.focusGroups ?? [];
    const present = new Set<string>();
    for (const g of groups) {
      if (!g.id || g.id.length > 200) throw new Error("invalid focus group id");
      present.add(g.id);
      const json = canonicalFocusGroupJson(this.toFocusPayload(g));
      if (this.focusGroupShadow.get(g.id) === json) continue;
      const aad = recordAad(this.userId, NS_FOCUS_GROUPS, g.id);
      const blob = await encryptRecord(this.dek, aad, json);
      await this.upsertRecord(NS_FOCUS_GROUPS, g.id, blob);
      this.focusGroupShadow.set(g.id, json);
      this.knownFocusGroupIds.add(g.id);
    }
    // Tombstone groups we synced before but the user has since removed.
    for (const id of [...this.knownFocusGroupIds]) {
      if (present.has(id)) continue;
      const aad = recordAad(this.userId, NS_FOCUS_GROUPS, id);
      const blob = await encryptRecord(this.dek, aad, JSON.stringify({ id }));
      await this.upsertRecord(NS_FOCUS_GROUPS, id, blob, true);
      this.focusGroupShadow.delete(id);
      this.knownFocusGroupIds.delete(id);
    }
    await setKnownFocusGroupIds(this.knownFocusGroupIds);
  }

  private async applyFocusGroupRows(rows: SyncRow[]): Promise<void> {
    if (!this.dek || !this.userId || rows.length === 0) return;
    const removed = new Set<string>();
    const upserts = new Map<string, FocusGroup>();
    for (const row of rows) {
      if (row.deleted) {
        removed.add(row.record_key);
        upserts.delete(row.record_key);
        this.focusGroupShadow.delete(row.record_key);
        this.knownFocusGroupIds.delete(row.record_key);
        continue;
      }
      if (!row.record_key || row.record_key.length > 200) throw new Error("invalid focus group id");
      const aad = recordAad(this.userId, NS_FOCUS_GROUPS, row.record_key);
      const json = await decryptRecord(this.dek, aad, fromBase64Url(row.ciphertext));
      if (json.length > 1_000_000) throw new Error("focus group is too large");
      const raw = JSON.parse(json) as Partial<FocusGroupPayload>;
      const payload = this.fromFocusPayload({
        id: row.record_key,
        name: typeof raw.name === "string" ? raw.name.slice(0, 100) : "Focus",
        mode: raw.mode === "all-except" ? "all-except" : "only",
        exitable: raw.exitable !== false,
        autoTurnOnDnd: raw.autoTurnOnDnd === true,
        domains: this.safeStringArray(raw.domains),
        packages: this.safeStringArray(raw.packages),
      });
      upserts.set(row.record_key, payload);
      removed.delete(row.record_key);
      // Store the canonical form so our own re-save is recognised and not pushed back.
      this.focusGroupShadow.set(row.record_key, canonicalFocusGroupJson(this.toFocusPayload(payload)));
      this.knownFocusGroupIds.add(row.record_key);
    }
    const settings = await get("settings");
    const byId = new Map((settings.focusGroups ?? []).map((g) => [g.id, g] as const));
    for (const id of removed) byId.delete(id);
    for (const [id, g] of upserts) byId.set(id, g);
    await setFromRemote("settings", { ...settings, focusGroups: [...byId.values()] });
    await setKnownFocusGroupIds(this.knownFocusGroupIds);
  }

  // Focus mode (cross platform) -----------------------------------------

  private focusJson(session: FocusSession | null): string {
    const active = session !== null && session.endsAt > Date.now() && session.pomodoro?.phase !== "break";
    return JSON.stringify({
      active,
      groupId: active ? session!.groupId : "",
      name: active ? session!.name : "",
      endsAt: active ? session!.endsAt : 0,
      startedAt: active ? session!.startedAt : 0,
      mode: active && session!.mode === "all-except" ? "all-except" : "only",
      exitable: active ? session!.exitable : true,
      domains: active ? [...session!.domains].sort() : [],
      packages: active ? [...(session!.packages ?? [])].sort() : [],
      origin: this.deviceId ?? "",
    });
  }

  async pushFocus(): Promise<void> {
    if (!this.billing.entitled) return;
    if (!this.preferences.reducerConfigs) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const session = await get("focus");
    const json = this.focusJson(session);
    if (json === this.lastFocusJson) return;
    const aad = recordAad(this.userId, NS_FOCUS, "active");
    const blob = await encryptRecord(this.dek, aad, json);
    await this.upsertRecord(NS_FOCUS, "active", blob);
    this.lastFocusJson = json;
  }

  private async applyFocusRow(row: SyncRow): Promise<void> {
    if (!this.dek || !this.userId) return;
    const aad = recordAad(this.userId, NS_FOCUS, row.record_key);
    const json = await decryptRecord(this.dek, aad, fromBase64Url(row.ciphertext));
    const p = JSON.parse(json) as {
      active: boolean;
      groupId: string;
      name: string;
      endsAt: number;
      startedAt: number;
      mode: string;
      exitable: boolean;
      domains: string[];
      packages?: string[];
    };
    if (json.length > 1_000_000 || p.groupId?.length > 200) throw new Error("invalid focus data");
    let session: FocusSession | null = null;
    if (p.active && p.endsAt > Date.now()) {
      const mode: FocusMode = p.mode === "all-except" ? "all-except" : "only-these";
      session = {
        groupId: p.groupId,
        name: typeof p.name === "string" ? p.name.slice(0, 100) || "Focus" : "Focus",
        domains: this.safeStringArray(p.domains),
        packages: this.safeStringArray(p.packages),
        mode,
        startedAt: p.startedAt || Date.now(),
        endsAt: p.endsAt,
        exitable: p.exitable,
        plannedMs: p.endsAt - (p.startedAt || Date.now()),
      };
    }
    // Set the canonical string first so the resulting storage change is not pushed back.
    this.lastFocusJson = this.focusJson(session);
    await setFromRemote("focus", session);
  }

  private async applyUsageRow(row: SyncRow, into: UsageHistory): Promise<boolean> {
    if (!this.dek || !this.userId) return false;
    const recordDate = row.record_key.slice(row.record_key.lastIndexOf(":") + 1);
    if (row.deleted) {
      const day = into[recordDate];
      if (!day) return false;
      const prefix = `${row.device_id}|`;
      let changed = false;
      for (const key of Object.keys(day)) {
        if (key.startsWith(prefix)) {
          delete day[key];
          changed = true;
        }
      }
      if (Object.keys(day).length === 0) delete into[recordDate];
      return changed;
    }
    const aad = recordAad(this.userId, NS_USAGE_WEB, row.record_key);
    const json = await decryptRecord(this.dek, aad, fromBase64Url(row.ciphertext));
    if (json.length > 2_000_000) throw new Error("usage record is too large");
    const p = JSON.parse(json) as UsageWebPayload;
    if (!row.device_id || row.record_key !== `${row.device_id}:${p.date}` || !this.isRetainedUsageDate(p.date)) {
      throw new Error("invalid usage record");
    }
    // One record carries a device's whole day. Replace that device's slots so
    // removing a domain on the source device is reflected, never accumulated.
    const day = (into[p.date] ??= {});
    const prefix = `${row.device_id}|`;
    for (const k of Object.keys(day)) if (k.startsWith(prefix)) delete day[k];
    const entries = Object.entries(p.domains ?? {});
    if (entries.length > 10_000) throw new Error("usage record has too many domains");
    for (const [domain, du] of entries) {
      if (!domain || domain.length > 1000 || !Number.isFinite(du.ms)) throw new Error("invalid usage entry");
      const paths: Record<string, number> = {};
      const pathEntries = Object.entries(du.paths ?? {});
      if (pathEntries.length > 20_000) throw new Error("usage record has too many paths");
      for (const [path, ms] of pathEntries) {
        if (path.length > 4000 || !Number.isFinite(ms)) throw new Error("invalid usage path");
        const relativePath = path === domain ? "" : path.startsWith(domain) ? path.slice(domain.length) : path;
        paths[relativePath] = (paths[relativePath] ?? 0) + Math.max(0, ms);
      }
      day[`${row.device_id}|${domain}`] = { ms: Math.max(0, du.ms), paths };
    }
    return true;
  }

  // Keep the cross device usage cache from growing without bound. Only recent
  // days are shown, so older ones are dropped.
  private pruneOldUsage(history: UsageHistory): void {
    const cutoff = this.localDateOffset(-28);
    const futureCutoff = this.localDateOffset(28);
    for (const date of Object.keys(history)) if (date < cutoff || date > futureCutoff) delete history[date];
  }

  // Collapse the per device remote slots into a domain keyed history and store
  // it where the UI reads it.
  private async publishRemoteUsage(raw: UsageHistory): Promise<void> {
    const collapsed: UsageHistory = {};
    for (const [date, day] of Object.entries(raw)) {
      const target = (collapsed[date] ??= {});
      for (const [slot, usage] of Object.entries(day)) {
        const domain = slot.includes("|") ? slot.slice(slot.indexOf("|") + 1) : slot;
        const existing = target[domain];
        if (!existing) {
          target[domain] = { ms: usage.ms, paths: { ...usage.paths } };
        } else {
          existing.ms += usage.ms;
          for (const [path, ms] of Object.entries(usage.paths)) existing.paths[path] = (existing.paths[path] ?? 0) + ms;
        }
      }
    }
    await browser.storage.local.set({ "sync.remoteUsageView": collapsed });
  }

  // Push -----------------------------------------------------------------

  private scheduleConfigPush(): void {
    if (!this.billing.entitled) return;
    if (this.configPushTimer) clearTimeout(this.configPushTimer);
    this.configPushTimer = setTimeout(() => {
      void this.pushConfig().catch((err) => this.recordError(err));
      void this.pushFocusGroups().catch((err) => this.recordError(err));
    }, PUSH_DEBOUNCE_MS);
  }

  private scheduleUsagePush(): void {
    if (!this.billing.entitled) return;
    if (this.usagePushTimer) clearTimeout(this.usagePushTimer);
    this.usagePushTimer = setTimeout(() => void this.pushUsage().catch((err) => this.recordError(err)), PUSH_DEBOUNCE_MS);
  }

  private async pushConfig(): Promise<void> {
    if (!this.billing.entitled) return;
    if (!this.preferences.reducerConfigs) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const settings = await get("settings");
    const json = this.configJson(settings);
    if (json === this.lastConfigJson) return; // nothing new, or this came from a pull
    const aad = recordAad(this.userId, NS_EXT_CONFIG, "config");
    const blob = await encryptRecord(this.dek, aad, json);
    await this.upsertRecord(NS_EXT_CONFIG, "config", blob);
    this.lastConfigJson = json;
  }

  private async pushUsage(): Promise<void> {
    if (!this.billing.entitled) return;
    if (!this.preferences.usageStats) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const usage = await getUsage(lastNDays(RETENTION_DAYS + 1));
    const retainedDates = Object.keys(usage).filter((date) => this.isRetainedUsageDate(date)).sort();
    for (const date of retainedDates) {
      const domains: UsageWebPayload["domains"] = {};
      for (const domain of Object.keys(usage[date] ?? {}).sort()) {
        const du = usage[date]![domain]!;
        // Match Android: short visits are local-only noise and path identifiers
        // include the domain so either platform can consume the payload directly.
        if (du.ms < 60_000) continue;
        const paths: Record<string, number> = {};
        for (const path of Object.keys(du.paths).sort()) paths[`${domain}${path}`] = Math.max(0, du.paths[path]!);
        domains[domain] = { ms: Math.max(0, du.ms), paths };
      }
      const payload: UsageWebPayload = { date, platform: PLATFORM, domains };
      const json = JSON.stringify(payload);
      if (this.usageShadows.get(date) === json) continue;
      const recordKey = `${this.deviceId}:${date}`;
      const aad = recordAad(this.userId, NS_USAGE_WEB, recordKey);
      const blob = await encryptRecord(this.dek, aad, json);
      await this.upsertRecord(NS_USAGE_WEB, recordKey, blob);
      this.usageShadows.set(date, json);
    }
  }

  private async upsertRecord(
    namespace: string,
    recordKey: string,
    blob: Uint8Array,
    deleted = false,
  ): Promise<void> {
    this.requirePremium();
    if (!this.userId || !this.deviceId) throw new Error("sign in first");
    try {
      await this.provider().upsertRecord({
        userId: this.userId,
        namespace,
        recordKey,
        deviceId: this.deviceId,
        ciphertext: toBase64Url(blob),
        version: Date.now(),
        deleted,
      });
    } catch (error) {
      this.lastError = String((error as Error)?.message ?? error);
      throw error;
    }
    this.lastError = null;
  }

  async syncNow(): Promise<void> {
    this.requirePremium();
    if (!this.dek) throw new Error("unlock sync first");
    await this.registerDevice();
    await this.refreshDevices();
    await this.pullSinceCursor();
    if (this.preferences.reducerConfigs) {
      await this.pushConfig();
      await this.pushFocusGroups();
      await this.pushFocus();
    }
    if (this.preferences.usageStats) await this.pushUsage();
    await this.pullSinceCursor();
  }

  private isRetainedUsageDate(date: string): boolean {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
    const parsed = new Date(`${date}T00:00:00`);
    if (Number.isNaN(parsed.getTime()) || dateKey(parsed) !== date) return false;
    const cutoff = this.localDateOffset(-28);
    const futureCutoff = this.localDateOffset(28);
    return date >= cutoff && date <= futureCutoff;
  }

  private localDateOffset(days: number): string {
    const value = new Date();
    value.setHours(12, 0, 0, 0);
    value.setDate(value.getDate() + days);
    return dateKey(value);
  }

  private safeStringArray(value: unknown): string[] {
    if (!Array.isArray(value) || value.length > 5000) {
      if (value == null) return [];
      throw new Error("invalid sync list");
    }
    const result: string[] = [];
    for (const item of value) {
      if (typeof item !== "string" || item.length > 1000) throw new Error("invalid sync list item");
      result.push(item);
    }
    return result;
  }

  private recordError(err: unknown): void {
    this.lastError = String((err as Error)?.message ?? err);
  }

  // Status ---------------------------------------------------------------

  private toSyncRow(record: SyncRecord): SyncRow {
    return {
      id: record.id,
      namespace: record.namespace,
      record_key: record.recordKey,
      device_id: record.deviceId,
      ciphertext: record.ciphertext,
      version: record.version,
      deleted: record.deleted,
      updated_at: record.updatedAt,
    };
  }

  async status(): Promise<SyncStatus> {
    if (!getSyncProvider()) {
      return {
        available: false,
        signedIn: false,
        email: null,
        hasVault: false,
        unlocked: false,
        deviceId: this.deviceId,
        lastSync: null,
        error: null,
        pendingEmail: null,
        devices: [],
        preferences: this.preferences,
        billing: { ...DEFAULT_SYNC_BILLING, required: false, entitled: false },
      };
    }
    try {
      this.rememberUser(await this.provider().currentUser());
    } catch (error) {
      this.recordError(error);
    }
    const signedIn = this.userId !== null;
    if (signedIn) {
      try { await this.refreshEntitlement(); } catch (error) { this.recordError(error); }
    }
    let hasVault = false;
    if (signedIn && this.billing.entitled) {
      try {
        hasVault = (await this.fetchVault()) !== null || (await getVaultMeta()) !== null;
      } catch {
        hasVault = (await getVaultMeta()) !== null;
      }
      try { await this.refreshDevices(); } catch { /* keep the last known list offline */ }
    }
    return {
      available: true,
      signedIn,
      email: this.email,
      hasVault,
      unlocked: this.billing.entitled && this.dek !== null,
      deviceId: this.deviceId,
      lastSync: this.lastSync,
      error: this.lastError,
      pendingEmail: signedIn ? null : this.pendingEmail,
      devices: this.devices,
      preferences: this.preferences,
      billing: this.billing,
    };
  }
}

let engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine();
  return engine;
}
