import { browser } from "#imports";
import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
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
import { getSupabase } from "../supabase";
import { dateKey, todayKey } from "../time";
import { get, isApplyingRemote, setFromRemote, watch } from "../storage";
import type { FocusGroup, FocusMode, FocusSession, Settings, UsageHistory } from "../types";
import {
  clearSyncState,
  getCursor,
  getDeviceId,
  getRemoteUsage,
  getSyncPreferences,
  getStoredDek,
  getVaultMeta,
  setCursor,
  setRemoteUsage,
  setSyncPreferences,
  setStoredDek,
  setVaultMeta,
  type VaultMeta,
} from "./local";
import {
  canonicalFocusGroupJson,
  NS_EXT_CONFIG,
  NS_FOCUS,
  NS_FOCUS_GROUPS,
  NS_USAGE_WEB,
  type FocusGroupPayload,
  type SyncStatus,
  type SyncDevice,
  type SyncPreferences,
  type UsageWebPayload,
} from "./types";

const PLATFORM = "ext";
const PUSH_DEBOUNCE_MS = 1500;

interface SyncRow {
  namespace: string;
  record_key: string;
  device_id: string | null;
  ciphertext: string;
  version: number;
  deleted: boolean;
  updated_at: string;
}

export class SyncEngine {
  private sb: SupabaseClient = getSupabase();
  private dek: CryptoKey | null = null;
  private dekBytes: Uint8Array | null = null;
  private userId: string | null = null;
  private deviceId: string | null = null;
  private channel: RealtimeChannel | null = null;
  private configPushTimer: ReturnType<typeof setTimeout> | null = null;
  private usagePushTimer: ReturnType<typeof setTimeout> | null = null;
  private lastConfigJson: string | null = null; // echo suppression for config
  private lastFocusJson: string | null = null; // echo suppression for focus
  private lastUsageJson: string | null = null; // dedup: skip re-pushing an unchanged day
  // Last synced canonical JSON per focus group id, so we only push real changes
  // and never bounce an applied remote group straight back up.
  private focusGroupShadow = new Map<string, string>();
  private lastSync: number | null = null;
  private lastError: string | null = null;
  private pendingEmail: string | null = null;
  private starting = false;
  private preferences: SyncPreferences = { usageStats: true, reducerConfigs: true, usageDeviceIds: [] };
  private devices: SyncDevice[] = [];

  async start(): Promise<void> {
    if (this.starting) return;
    this.starting = true;
    this.deviceId = await getDeviceId();
    this.preferences = await getSyncPreferences();

    this.sb.auth.onAuthStateChange((_event, session) => {
      this.userId = session?.user.id ?? null;
      if (this.userId) void this.onSignedIn();
      else void this.teardown();
    });

    const { data } = await this.sb.auth.getSession();
    this.userId = data.session?.user.id ?? null;
    if (this.userId) await this.onSignedIn();

    watch((changed) => {
      if (isApplyingRemote()) return;
      if ("settings" in changed) this.scheduleConfigPush();
      if ("usage" in changed) this.scheduleUsagePush();
      if ("focus" in changed) void this.pushFocus();
    });
  }

  private async onSignedIn(): Promise<void> {
    const stored = await getStoredDek();
    if (stored) {
      this.dekBytes = fromBase64Url(stored);
      this.dek = await importDEK(this.dekBytes);
    }
    await this.registerDevice();
    await this.refreshDevices();
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
    if (this.channel) {
      await this.sb.removeChannel(this.channel);
      this.channel = null;
    }
    this.dek = null;
    this.dekBytes = null;
  }

  // Auth -----------------------------------------------------------------

  async signUp(email: string, password: string): Promise<void> {
    const { data, error } = await this.sb.auth.signUp({ email, password });
    if (error) throw error;
    // With email confirmation on, no session comes back yet. Ask for the code.
    if (!data.session) this.pendingEmail = email;
  }

  async signIn(email: string, password: string): Promise<void> {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) {
      if (/confirm/i.test(error.message)) {
        this.pendingEmail = email;
        return;
      }
      throw error;
    }
  }

  async verifyCode(email: string, code: string): Promise<void> {
    const { error } = await this.sb.auth.verifyOtp({ email, token: code.trim(), type: "signup" });
    if (error) throw error;
    this.pendingEmail = null;
  }

  async resendCode(email: string): Promise<void> {
    const { error } = await this.sb.auth.resend({ type: "signup", email });
    if (error) throw error;
  }

  async sendReset(email: string): Promise<void> {
    const { error } = await this.sb.auth.resetPasswordForEmail(email);
    if (error) throw error;
  }

  async resetPassword(email: string, code: string, password: string): Promise<void> {
    const { error } = await this.sb.auth.verifyOtp({ email, token: code.trim(), type: "recovery" });
    if (error) throw error;
    const { error: upErr } = await this.sb.auth.updateUser({ password });
    if (upErr) throw upErr;
    this.pendingEmail = null;
  }

  async signOut(): Promise<void> {
    await this.sb.auth.signOut();
    await clearSyncState();
    this.lastConfigJson = null;
    this.lastFocusJson = null;
    this.lastUsageJson = null;
    this.focusGroupShadow.clear();
    this.lastSync = null;
    this.pendingEmail = null;
  }

  // Vault and unlocking --------------------------------------------------

  private async fetchVault(): Promise<VaultMeta | null> {
    if (!this.userId) return null;
    const { data, error } = await this.sb
      .from("vault")
      .select("kdf_salt, kdf_params, wrapped_dek")
      .eq("user_id", this.userId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return null;
    return {
      userId: this.userId,
      saltB64: data.kdf_salt as string,
      params: data.kdf_params as VaultMeta["params"],
      wrappedB64: data.wrapped_dek as string,
    };
  }

  // First time setup: generate a fresh data key, wrap it under the passphrase,
  // and store the envelope on the server.
  async setPassphrase(passphrase: string): Promise<void> {
    if (!this.userId) throw new Error("sign in first");
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
    const { error } = await this.sb.from("vault").insert({
      user_id: this.userId,
      kdf_salt: meta.saltB64,
      kdf_params: meta.params,
      wrapped_dek: meta.wrappedB64,
    });
    if (error) throw error;

    await this.adoptDek(dekBytes, meta);
    await this.onSignedIn();
  }

  async unlock(passphrase: string): Promise<void> {
    if (!this.userId) throw new Error("sign in first");
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
    if (!this.userId || !this.dekBytes) throw new Error("unlock first");
    return buildPairingPayload(this.userId, this.dekBytes);
  }

  async pairWithCode(payload: string): Promise<void> {
    if (!this.userId) throw new Error("sign in first");
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
    if (!this.userId || !this.deviceId) return;
    await this.sb.from("devices").upsert(
      {
        id: this.deviceId,
        user_id: this.userId,
        platform: `${PLATFORM}-${this.browserLabel()}`,
        label: this.browserLabel(),
        last_seen: new Date().toISOString(),
      },
      { onConflict: "id" },
    );
  }

  private async refreshDevices(): Promise<void> {
    if (!this.userId) return;
    const { data, error } = await this.sb.from("devices").select("id, platform, label, last_seen").eq("user_id", this.userId).order("last_seen", { ascending: false });
    if (error) throw error;
    this.devices = (data ?? []).map((d) => ({
      id: d.id as string,
      platform: d.platform as string,
      label: ((d.label as string | null) || (d.platform as string) || "Device").trim(),
      lastSeen: d.last_seen as string | null,
      current: d.id === this.deviceId,
    }));
  }

  async setDeviceName(name: string): Promise<void> {
    const label = name.trim().slice(0, 60);
    if (!label || !this.userId || !this.deviceId) throw new Error("Enter a device name");
    const { error } = await this.sb.from("devices").update({ label }).eq("id", this.deviceId).eq("user_id", this.userId);
    if (error) throw error;
    await this.refreshDevices();
  }

  async setPreferences(preferences: SyncPreferences): Promise<void> {
    this.preferences = { ...preferences, usageDeviceIds: [...new Set(preferences.usageDeviceIds)] };
    await setSyncPreferences(this.preferences);
    await setCursor("1970-01-01T00:00:00Z");
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
    if (this.channel || !this.userId) return;
    this.channel = this.sb
      .channel(`sync:${this.userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "sync_records", filter: `user_id=eq.${this.userId}` },
        () => void this.pullSinceCursor(),
      )
      .subscribe();
  }

  // Pull -----------------------------------------------------------------

  async pullSinceCursor(): Promise<void> {
    if (!this.dek || !this.userId) return;
    try {
      const cursor = (await getCursor()) ?? "1970-01-01T00:00:00Z";
      const { data, error } = await this.sb
        .from("sync_records")
        .select("namespace, record_key, device_id, ciphertext, version, deleted, updated_at")
        .eq("user_id", this.userId)
        .gt("updated_at", cursor)
        .order("updated_at", { ascending: true });
      if (error) throw error;
      const rows = (data ?? []) as SyncRow[];
      if (rows.length === 0) {
        this.lastSync = Date.now();
        return;
      }

      let configRow: SyncRow | null = null;
      let focusRow: SyncRow | null = null;
      const focusGroupRows: SyncRow[] = [];
      const remoteUsage = await getRemoteUsage();
      let usageChanged = false;

      // Hold the high water mark and only commit it once the whole batch has been
      // applied. One undecryptable row is skipped instead of aborting the batch,
      // but the cursor never moves past work that has not finished, so a failure
      // mid pull just retries on the next tick rather than dropping records.
      let maxCursor = cursor;
      for (const row of rows) {
        try {
          if (this.preferences.reducerConfigs && row.namespace === NS_EXT_CONFIG && row.device_id !== this.deviceId) {
            configRow = row; // keep only the latest, rows arrive in updated_at order
          } else if (this.preferences.reducerConfigs && row.namespace === NS_FOCUS && row.device_id !== this.deviceId) {
            focusRow = row;
          } else if (this.preferences.reducerConfigs && row.namespace === NS_FOCUS_GROUPS && row.device_id !== this.deviceId) {
            focusGroupRows.push(row);
          } else if (this.preferences.usageStats && row.namespace === NS_USAGE_WEB && row.device_id !== this.deviceId &&
            (this.preferences.usageDeviceIds.length === 0 || (row.device_id && this.preferences.usageDeviceIds.includes(row.device_id)))) {
            if (await this.applyUsageRow(row, remoteUsage)) usageChanged = true;
          }
        } catch {
          // Skip a single bad row; the rest of the batch still applies.
        }
        if (row.updated_at > maxCursor) maxCursor = row.updated_at;
      }

      if (focusGroupRows.length > 0) {
        try {
          await this.applyFocusGroupRows(focusGroupRows);
        } catch {
          /* leave focus groups for a later pull */
        }
      }
      if (configRow) {
        try {
          await this.applyConfigRow(configRow);
        } catch {
          /* leave config for a later pull */
        }
      }
      if (focusRow) {
        try {
          await this.applyFocusRow(focusRow);
        } catch {
          /* leave focus for a later pull */
        }
      }
      if (usageChanged) {
        this.pruneOldUsage(remoteUsage);
        await setRemoteUsage(remoteUsage);
        await this.publishRemoteUsage(remoteUsage);
      }
      await setCursor(maxCursor);
      this.lastSync = Date.now();
      this.lastError = null;
    } catch (err) {
      this.lastError = String((err as Error).message ?? err);
    }
  }

  // Config is per platform and deliberately excludes focus groups, which travel
  // cross platform through their own namespace. Stripping them here keeps the two
  // sync paths from fighting over the same data.
  private configJson(settings: Settings): string {
    return JSON.stringify({ ...settings, focusGroups: [] });
  }

  private async applyConfigRow(row: SyncRow): Promise<void> {
    if (!this.dek || !this.userId) return;
    const aad = recordAad(this.userId, NS_EXT_CONFIG, row.record_key);
    const json = await decryptRecord(this.dek, aad, fromBase64Url(row.ciphertext));
    const remote = JSON.parse(json) as Settings;
    const local = await get("settings");
    if (this.configJson(local) === json) return;
    this.lastConfigJson = json; // remember so our own re-save is not pushed back
    // Keep our own focus groups; the config payload no longer carries them.
    await setFromRemote("settings", { ...remote, focusGroups: local.focusGroups });
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
    if (!this.preferences.reducerConfigs) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const settings = await get("settings");
    const groups = settings.focusGroups ?? [];
    const present = new Set<string>();
    for (const g of groups) {
      present.add(g.id);
      const json = canonicalFocusGroupJson(this.toFocusPayload(g));
      if (this.focusGroupShadow.get(g.id) === json) continue;
      const aad = recordAad(this.userId, NS_FOCUS_GROUPS, g.id);
      const blob = await encryptRecord(this.dek, aad, json);
      await this.upsertRecord(NS_FOCUS_GROUPS, g.id, blob);
      this.focusGroupShadow.set(g.id, json);
    }
    // Tombstone groups we synced before but the user has since removed.
    for (const id of [...this.focusGroupShadow.keys()]) {
      if (present.has(id)) continue;
      const aad = recordAad(this.userId, NS_FOCUS_GROUPS, id);
      const blob = await encryptRecord(this.dek, aad, JSON.stringify({ id }));
      await this.upsertRecord(NS_FOCUS_GROUPS, id, blob, true);
      this.focusGroupShadow.delete(id);
    }
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
        continue;
      }
      const aad = recordAad(this.userId, NS_FOCUS_GROUPS, row.record_key);
      const json = await decryptRecord(this.dek, aad, fromBase64Url(row.ciphertext));
      const payload = this.fromFocusPayload(JSON.parse(json) as FocusGroupPayload);
      upserts.set(row.record_key, payload);
      removed.delete(row.record_key);
      // Store the canonical form so our own re-save is recognised and not pushed back.
      this.focusGroupShadow.set(row.record_key, canonicalFocusGroupJson(this.toFocusPayload(payload)));
    }
    const settings = await get("settings");
    const byId = new Map((settings.focusGroups ?? []).map((g) => [g.id, g] as const));
    for (const id of removed) byId.delete(id);
    for (const [id, g] of upserts) byId.set(id, g);
    await setFromRemote("settings", { ...settings, focusGroups: [...byId.values()] });
  }

  // Focus mode (cross platform) -----------------------------------------

  private focusJson(session: FocusSession | null): string {
    const active = session !== null && session.endsAt > Date.now();
    return JSON.stringify({
      active,
      groupId: active ? session!.groupId : "",
      name: active ? session!.name : "",
      endsAt: active ? session!.endsAt : 0,
      startedAt: active ? session!.startedAt : 0,
      mode: active && session!.mode === "all-except" ? "all-except" : "only",
      exitable: active ? session!.exitable : true,
      domains: active ? [...session!.domains].sort() : [],
      packages: [],
    });
  }

  async pushFocus(): Promise<void> {
    if (!this.preferences.reducerConfigs) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const session = await get("focus");
    const json = this.focusJson(session);
    if (json === this.lastFocusJson) return;
    this.lastFocusJson = json;
    const aad = recordAad(this.userId, NS_FOCUS, "active");
    const blob = await encryptRecord(this.dek, aad, json);
    await this.upsertRecord(NS_FOCUS, "active", blob);
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
    };
    let session: FocusSession | null = null;
    if (p.active && p.endsAt > Date.now()) {
      const mode: FocusMode = p.mode === "all-except" ? "all-except" : "only-these";
      session = {
        groupId: p.groupId,
        name: p.name || "Focus",
        domains: p.domains ?? [],
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
    const aad = recordAad(this.userId, NS_USAGE_WEB, row.record_key);
    const json = await decryptRecord(this.dek, aad, fromBase64Url(row.ciphertext));
    const p = JSON.parse(json) as UsageWebPayload;
    // One record carries a device's whole day. Replace that device's slots so
    // removing a domain on the source device is reflected, never accumulated.
    const day = (into[p.date] ??= {});
    const prefix = `${row.device_id}|`;
    for (const k of Object.keys(day)) if (k.startsWith(prefix)) delete day[k];
    for (const [domain, du] of Object.entries(p.domains ?? {})) {
      day[`${row.device_id}|${domain}`] = { ms: du.ms, paths: du.paths ?? {} };
    }
    return true;
  }

  // Keep the cross device usage cache from growing without bound. Only recent
  // days are shown, so older ones are dropped.
  private pruneOldUsage(history: UsageHistory): void {
    const cutoff = dateKey(new Date(Date.now() - 14 * 86_400_000));
    for (const date of Object.keys(history)) if (date < cutoff) delete history[date];
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
    if (this.configPushTimer) clearTimeout(this.configPushTimer);
    this.configPushTimer = setTimeout(() => {
      void this.pushConfig();
      void this.pushFocusGroups();
    }, PUSH_DEBOUNCE_MS);
  }

  private scheduleUsagePush(): void {
    if (this.usagePushTimer) clearTimeout(this.usagePushTimer);
    this.usagePushTimer = setTimeout(() => void this.pushUsage(), PUSH_DEBOUNCE_MS);
  }

  private async pushConfig(): Promise<void> {
    if (!this.preferences.reducerConfigs) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const settings = await get("settings");
    const json = this.configJson(settings);
    if (json === this.lastConfigJson) return; // nothing new, or this came from a pull
    this.lastConfigJson = json;
    const aad = recordAad(this.userId, NS_EXT_CONFIG, "config");
    const blob = await encryptRecord(this.dek, aad, json);
    await this.upsertRecord(NS_EXT_CONFIG, "config", blob);
  }

  private async pushUsage(): Promise<void> {
    if (!this.preferences.usageStats) return;
    if (!this.dek || !this.userId || !this.deviceId) return;
    const usage = await get("usage");
    // Key by local day, the same boundary the tracker and blocker use, so we
    // never push the wrong calendar day in the hours either side of UTC midnight.
    const today = todayKey();
    const day = usage[today];
    if (!day) return;
    const domains: UsageWebPayload["domains"] = {};
    for (const [domain, du] of Object.entries(day)) domains[domain] = { ms: du.ms, paths: du.paths };
    const payload: UsageWebPayload = { date: today, platform: PLATFORM, domains };
    const json = JSON.stringify(payload);
    if (json === this.lastUsageJson) return; // nothing changed since the last push
    this.lastUsageJson = json;
    const recordKey = `${this.deviceId}:${today}`;
    const aad = recordAad(this.userId, NS_USAGE_WEB, recordKey);
    const blob = await encryptRecord(this.dek, aad, json);
    await this.upsertRecord(NS_USAGE_WEB, recordKey, blob);
  }

  private async upsertRecord(
    namespace: string,
    recordKey: string,
    blob: Uint8Array,
    deleted = false,
  ): Promise<void> {
    if (!this.userId || !this.deviceId) return;
    const { error } = await this.sb.from("sync_records").upsert(
      {
        user_id: this.userId,
        namespace,
        record_key: recordKey,
        device_id: this.deviceId,
        ciphertext: toBase64Url(blob),
        version: Date.now(),
        deleted,
      },
      { onConflict: "user_id,namespace,record_key" },
    );
    if (error) this.lastError = error.message;
  }

  // Status ---------------------------------------------------------------

  async status(): Promise<SyncStatus> {
    const { data } = await this.sb.auth.getUser();
    const signedIn = !!data.user;
    let hasVault = false;
    if (signedIn) {
      try {
        hasVault = (await this.fetchVault()) !== null || (await getVaultMeta()) !== null;
      } catch {
        hasVault = (await getVaultMeta()) !== null;
      }
      try { await this.refreshDevices(); } catch { /* keep the last known list offline */ }
    }
    return {
      signedIn,
      email: data.user?.email ?? null,
      hasVault,
      unlocked: this.dek !== null,
      deviceId: this.deviceId,
      lastSync: this.lastSync,
      error: this.lastError,
      pendingEmail: signedIn ? null : this.pendingEmail,
      devices: this.devices,
      preferences: this.preferences,
    };
  }
}

let engine: SyncEngine | null = null;

export function getSyncEngine(): SyncEngine {
  if (!engine) engine = new SyncEngine();
  return engine;
}
