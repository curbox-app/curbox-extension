import { browser } from "#imports";
import { fromBase64Url, randomBytes, toBase64Url, toHex } from "../crypto";
import { get, getUsage, update } from "../storage";
import { lastNDays } from "../time";
import { activeSession, endSession, startSessionUntil } from "../../core/focus";
import { deriveLanKey, normalizeCode, CODE_LENGTH, open, REQUEST_AAD, responseAad, seal } from "./crypto";
import type { FocusGroup } from "../types";
import { candidateSubnets, newPairingCode, pairingLink } from "./link";
import { decide, localView, phoneView, sameGroup, type FocusView, type PhoneState } from "./reconcile";
import { changedDays, clientName, DAYS_PER_REQUEST, USAGE_DAYS, usageDays } from "./usage";

// Focus mode sync with Curbox on an Android phone over the local WiFi, through
// the CurboxSync companion app. The phone runs the server; this side decides
// which device moved and makes the other one follow. See CurboxSync/PROTOCOL.md.

export const LAN_PORT = 47621;
const K_CONFIG = "lan.config";
const K_STATE = "lan.state";
const K_LOCAL_CHANGED = "lan.localChangedAt";
const K_PENDING = "lan.pending";
const K_LAST_ADDRESS = "lan.lastAddress";
const K_PLACES = "lan.places";
const K_USAGE = "lan.usage";
const K_CLIENT = "lan.clientId";
const ROAM_REST_MS = 5 * 60_000;
const USAGE_EVERY_MS = 60_000;
const PAIRING_MS = 10 * 60_000;

interface PendingPairing {
  code: string;
  key: string;
  startedAt: number;
  hint: string | null;
}
const WAIT_MS = 25_000;

interface LanConfig {
  address: string;
  key: string;
}

interface LanState {
  last: { local: FocusView; phone: FocusView } | null;
  rev: number;
  lastOkAt: number;
  phone: PhoneState | null;
  /** Connection problems; cleared by the next good round. */
  message: string;
  /** Outcome of the last sync step; kept until another step runs. */
  note?: string;
}

interface Reply {
  ok: boolean;
  phone: PhoneState;
  result?: string;
  now: number;
  /** Proto 2: the network the phone is on. */
  net?: { id: string; label: string; address: string };
  /** Proto 2, `usage` replies: the totals the phone holds for this browser. */
  known?: Record<string, number>;
  error?: string;
}

/** The phone's address on one network, so it is found again after a move. */
export interface LanPlace {
  id: string;
  label: string;
  address: string;
  lastOkAt: number;
}

interface UsageSync {
  /** Which pairing the known totals belong to. */
  key: string;
  known: Record<string, number> | null;
  sentAt: number;
}

export interface LanStatus {
  paired: boolean;
  address: string;
  reachable: boolean;
  lastOkAt: number;
  phone: PhoneState | null;
  message: string;
  /** While waiting for the phone to scan: the link to show as a QR code. */
  pairingLink: string | null;
  /** Networks this browser has met the phone on, newest first. */
  places: LanPlace[];
  /** The network the phone was last seen on. */
  placeId: string;
  usageSentAt: number;
}

export type LanRequest =
  | { type: "lan:status" }
  | { type: "lan:pair"; address: string; code: string }
  | { type: "lan:startPairing"; hint: string | null }
  | { type: "lan:cancelPairing" }
  | { type: "lan:unpair" }
  | { type: "lan:syncNow" }
  | { type: "lan:forgetPlace"; id: string };

export type LanResponse = { ok: boolean; error?: string; status: LanStatus };

export function isLanRequest(m: unknown): m is LanRequest {
  return typeof m === "object" && m !== null && String((m as { type?: unknown }).type).startsWith("lan:");
}

class LanError extends Error {
  constructor(readonly kind: "code" | "unreachable" | "bad", message: string) {
    super(message);
  }
}

const EMPTY_STATE: LanState = { last: null, rev: -1, lastOkAt: 0, phone: null, message: "" };

async function read<T>(key: string, fallback: T): Promise<T> {
  const res = await browser.storage.local.get(key);
  return (res[key] as T | undefined) ?? fallback;
}

const write = (key: string, value: unknown) => browser.storage.local.set({ [key]: value });

export function normalizeAddress(raw: string): string {
  const trimmed = raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (!/^[a-z0-9.\-]+(:\d{1,5})?$/i.test(trimmed) && !/^\[[0-9a-f:]+\](:\d{1,5})?$/i.test(trimmed)) {
    throw new LanError("bad", "That address does not look right. It looks like 192.168.1.20:47621.");
  }
  return /:\d{1,5}$/.test(trimmed) ? trimmed : `${trimmed}:${LAN_PORT}`;
}

async function rpc(config: LanConfig, body: Record<string, unknown>, timeoutMs = 10_000): Promise<Reply> {
  const key = fromBase64Url(config.key);
  const id = toHex(randomBytes(16));
  const blob = await seal(key, REQUEST_AAD, JSON.stringify({ ...body, id, ts: Date.now() }));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let res: Response;
  try {
    res = await fetch(`http://${config.address}/v1/rpc`, {
      method: "POST",
      body: blob,
      headers: { "content-type": "text/plain" },
      cache: "no-store",
      signal: ctrl.signal,
    });
  } catch {
    throw new LanError("unreachable", "I cannot reach your phone. Make sure both are on the same WiFi and Curbox Sync is on.");
  } finally {
    clearTimeout(timer);
  }
  if (res.status === 401) {
    throw new LanError("code", "Your phone did not accept the pairing code. Check the code and that both clocks are right.");
  }
  if (!res.ok) throw new LanError("unreachable", "Your phone answered in a way I did not expect.");
  const reply = JSON.parse(await open(key, responseAad(id), await res.text())) as Reply;
  if (!reply.phone || typeof reply.phone.rev !== "number") throw new LanError("bad", "Your phone sent something I could not read.");
  return reply;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Returns the addresses in a /24 that answer like Curbox Sync. */
async function sweepSubnet(subnet: string, concurrency = 64): Promise<string[]> {
  const found: string[] = [];
  const hosts = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}:${LAN_PORT}`);
  const probe = async (address: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 1_500);
    try {
      const res = await fetch(`http://${address}/v1/hello`, { cache: "no-store", signal: ctrl.signal });
      if (res.ok && ((await res.json()) as { app?: string }).app === "curbox-sync") found.push(address);
    } catch {
      // Nothing there.
    } finally {
      clearTimeout(timer);
    }
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (next < hosts.length) await probe(hosts[next++]);
    }),
  );
  return found;
}

export class LanSync {
  private queue: Promise<unknown> = Promise.resolve();
  private pollToken = 0;

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.queue.then(fn);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private config(): Promise<LanConfig | null> {
    return read<LanConfig | null>(K_CONFIG, null);
  }

  private state(): Promise<LanState> {
    return read(K_STATE, EMPTY_STATE);
  }

  private async patchState(change: Partial<LanState>): Promise<void> {
    await write(K_STATE, { ...(await this.state()), ...change });
  }

  async start(): Promise<void> {
    if (await this.config()) this.startPolling();
    else if (await this.pending()) void this.discover();
  }

  async status(): Promise<LanStatus> {
    const [config, state, pending, places, usage] = await Promise.all([
      this.config(), this.state(), this.pending(), this.places(), read<UsageSync | null>(K_USAGE, null),
    ]);
    // The worker may have restarted while the code was on screen; keep looking.
    if (!config && pending) void this.discover();
    return {
      paired: config !== null,
      address: config?.address ?? "",
      reachable: Date.now() - state.lastOkAt < 60_000,
      lastOkAt: state.lastOkAt,
      phone: state.phone,
      message: state.message || state.note || "",
      pairingLink: !config && pending ? pairingLink(pending.code) : null,
      places,
      placeId: places.find((p) => p.address === config?.address)?.id ?? "",
      usageSentAt: config && usage?.key === config.key ? usage.sentAt : 0,
    };
  }

  private async places(): Promise<LanPlace[]> {
    const places = await read<LanPlace[]>(K_PLACES, []);
    return [...places].sort((a, b) => b.lastOkAt - a.lastOkAt);
  }

  private async notePlace(config: LanConfig, reply: Reply): Promise<void> {
    if (!reply.net?.id) return;
    const places = await this.places();
    const old = places.find((p) => p.id === reply.net!.id);
    // Rewrite only when something visible changed, or once a minute.
    if (old && old.address === config.address && old.label === reply.net.label && Date.now() - old.lastOkAt < 60_000) return;
    const place: LanPlace = { id: reply.net.id, label: reply.net.label, address: config.address, lastOkAt: Date.now() };
    await write(K_PLACES, [place, ...places.filter((p) => p.id !== place.id)].slice(0, 12));
  }

  async forgetPlace(id: string): Promise<void> {
    await write(K_PLACES, (await this.places()).filter((p) => p.id !== id));
  }

  /** Sends a request to the paired phone and remembers which network answered. */
  private async call(config: LanConfig, body: Record<string, unknown>, timeoutMs?: number): Promise<Reply> {
    const reply = await rpc(config, body, timeoutMs);
    await this.notePlace(config, reply).catch(() => undefined);
    return reply;
  }

  private roamJob: Promise<LanConfig | null> | null = null;
  private roamRound = 0;
  private roamRestUntil = 0;

  /**
   * The phone stopped answering at its address, most likely because one of the
   * devices moved to another WiFi. Tries the phone's other saved addresses, then
   * sweeps one range per call with the paired key. Returns the new config if found.
   */
  private roam(config: LanConfig): Promise<LanConfig | null> {
    if (Date.now() < this.roamRestUntil) return Promise.resolve(null);
    // The poll loop and the tick can both notice at once; they share one search.
    this.roamJob ??= this.search(config).finally(() => (this.roamJob = null));
    return this.roamJob;
  }

  private async search(config: LanConfig): Promise<LanConfig | null> {
    const places = await this.places();
    const tryAt = async (address: string) => {
      const moved = { ...config, address };
      await this.call(moved, { op: "state" }, 2_500);
      return moved;
    };
    const saved = places.map((p) => p.address).filter((a) => a !== config.address);
    if (saved.length) {
      const found = await Promise.any(saved.map(tryAt)).catch(() => null);
      if (found) return await this.moveTo(found);
    }
    const subnets = candidateSubnets(config.address, ...places.map((p) => p.address));
    const subnet = subnets[this.roamRound % subnets.length];
    this.roamRound++;
    if (this.roamRound % subnets.length === 0) this.roamRestUntil = Date.now() + ROAM_REST_MS;
    for (const address of await sweepSubnet(subnet)) {
      if (address === config.address) continue;
      const found = await tryAt(address).catch(() => null);
      if (found) return await this.moveTo(found);
    }
    return null;
  }

  private async moveTo(config: LanConfig): Promise<LanConfig> {
    if (!(await this.config())) return config;
    this.roamRound = 0;
    this.roamRestUntil = 0;
    await write(K_CONFIG, config);
    await write(K_LAST_ADDRESS, config.address);
    await this.patchState({ message: "" });
    return config;
  }

  /** Reaches the phone, following it to another network when it moved. */
  private async reach(config: LanConfig, body: Record<string, unknown>, timeoutMs?: number): Promise<{ config: LanConfig; reply: Reply }> {
    try {
      return { config, reply: await this.call(config, body, timeoutMs) };
    } catch (err) {
      if (!(err instanceof LanError) || err.kind !== "unreachable") throw err;
      const moved = await this.roam(config);
      if (!moved) throw err;
      return { config: moved, reply: await this.call(moved, body, timeoutMs) };
    }
  }

  private usageBusy = false;

  /** Shares this browser's daily site totals with the phone, at most once a minute. */
  private async pushUsage(config: LanConfig): Promise<void> {
    if (this.usageBusy) return;
    let sync = await read<UsageSync | null>(K_USAGE, null);
    if (!sync || sync.key !== config.key) sync = { key: config.key, known: null, sentAt: 0 };
    if (Date.now() - sync.sentAt < USAGE_EVERY_MS) return;
    this.usageBusy = true;
    try {
      let clientId = await read<string | null>(K_CLIENT, null);
      if (!clientId) await write(K_CLIENT, (clientId = toHex(randomBytes(12))));
      const days = lastNDays(USAGE_DAYS);
      const ignored = (await get("settings")).usageIgnoredSites ?? [];
      let pending = changedDays(usageDays(await getUsage(days), days, ignored), sync.known);
      // Nothing new; a first contact still asks once what the phone holds.
      if (pending.length === 0 && sync.known !== null) {
        await write(K_USAGE, { ...sync, sentAt: Date.now() });
        return;
      }
      let rounds = 0;
      do {
        const batch = pending.slice(0, DAYS_PER_REQUEST);
        const reply = await this.call(config, { op: "usage", client: { id: clientId, name: clientName() }, days: batch });
        // A phone on proto 1 does not know usage; try again in a while.
        if (!reply.ok || !reply.known) {
          await write(K_USAGE, { ...sync, sentAt: Date.now() + 60 * 60_000 });
          return;
        }
        sync = { key: config.key, known: reply.known, sentAt: Date.now() };
        pending = pending.slice(batch.length);
      } while (pending.length && ++rounds < 4);
      await write(K_USAGE, sync);
    } finally {
      this.usageBusy = false;
    }
  }

  private async pending(): Promise<PendingPairing | null> {
    const p = await read<PendingPairing | null>(K_PENDING, null);
    return p && Date.now() - p.startedAt < PAIRING_MS ? p : null;
  }

  /**
   * Shows a code for the phone to scan, then looks for the phone on the WiFi.
   * The browser cannot be reached by the phone, so it has to do the finding.
   */
  async startPairing(hint: string | null): Promise<void> {
    let pending = await this.pending();
    if (!pending) {
      const code = newPairingCode();
      pending = { code, key: toBase64Url(await deriveLanKey(code)), startedAt: Date.now(), hint };
    } else if (hint) {
      pending = { ...pending, hint };
    }
    await write(K_PENDING, pending);
    void this.discover();
  }

  async cancelPairing(): Promise<void> {
    await browser.storage.local.remove(K_PENDING);
  }

  private discovering = false;

  private async discover(): Promise<void> {
    if (this.discovering) return;
    this.discovering = true;
    try {
      const phones = new Set<string>();
      let sweep = 0;
      for (;;) {
        const pending = await this.pending();
        if (!pending || (await this.config())) return;
        for (const address of phones) {
          try {
            await this.adopt({ address, key: pending.key });
            await browser.storage.local.remove(K_PENDING);
            return;
          } catch {
            // Found the app but it has not scanned this code yet.
          }
        }
        const lastAddress = await read<string | null>(K_LAST_ADDRESS, null);
        const subnets = candidateSubnets(pending.hint, lastAddress);
        const likely = Math.max(1, Number(!!pending.hint) + Number(!!lastAddress));
        // The likeliest ranges come back every other round, so a phone that turns
        // sync on late is still found quickly. Once found, sweep only now and then.
        const subnet = sweep % 2 === 0 ? subnets[(sweep / 2) % likely] : subnets[likely + ((sweep - 1) / 2) % (subnets.length - likely)];
        if (phones.size === 0 || sweep % 8 === 0) {
          for (const found of await sweepSubnet(subnet)) phones.add(found);
        }
        sweep++;
        await sleep(phones.size ? 1_500 : 200);
      }
    } finally {
      this.discovering = false;
    }
  }

  /** Confirms the phone opens our sealed requests, then saves it as the paired phone. */
  private async adopt(config: LanConfig): Promise<void> {
    const first = await this.call(config, { op: "state" }, 4_000);
    this.pollToken++;
    await write(K_CONFIG, config);
    await write(K_LAST_ADDRESS, config.address);
    await browser.storage.local.remove(K_PENDING);
    // The phone already answered, so pairing worked even if the first sync does not.
    await write(K_STATE, { ...EMPTY_STATE, lastOkAt: Date.now(), phone: first.phone });
    this.startPolling();
    await this.syncNow().catch(() => undefined);
  }

  /** Pairs with an address and the code shown on the phone, typed by hand. */
  async pair(address: string, code: string): Promise<void> {
    const normalized = normalizeCode(code);
    if (normalized.length !== CODE_LENGTH) throw new LanError("bad", "The pairing code has 12 letters and numbers.");
    await this.adopt({ address: normalizeAddress(address), key: toBase64Url(await deriveLanKey(normalized)) });
    await browser.storage.local.remove(K_PENDING);
  }

  async unpair(): Promise<void> {
    this.pollToken++;
    const config = await this.config();
    if (config) await write(K_LAST_ADDRESS, config.address);
    await browser.storage.local.remove([K_CONFIG, K_STATE, K_LOCAL_CHANGED, K_USAGE]);
  }

  /** Called whenever the local focus key changes. */
  async onLocalFocusChanged(): Promise<void> {
    if (!(await this.config())) return;
    await write(K_LOCAL_CHANGED, Date.now());
    await this.syncNow().catch(() => undefined);
  }

  /** Reads the phone and reconciles once; also revives the poll loop after the worker slept. */
  async syncNow(): Promise<void> {
    const config = await this.config();
    if (!config) return;
    if (this.pollToken === 0) this.startPolling();
    const reached = await this.serial(async () => {
      try {
        const r = await this.reach(config, { op: "state" });
        await this.reconcile(r.config, r.reply);
        return r.config;
      } catch (err) {
        await this.patchState({ message: String((err as Error).message ?? err) });
        throw err;
      }
    });
    void this.pushUsage(reached).catch(() => undefined);
  }

  // Long poll: the phone answers as soon as its focus changes, or after 25s.
  private startPolling(): void {
    const token = ++this.pollToken;
    void (async () => {
      while (token === this.pollToken) {
        const config = await this.config();
        if (!config) return;
        try {
          const { rev } = await this.state();
          const { config: at, reply } = await this.reach(config, { op: "wait", since: rev, wait: WAIT_MS }, WAIT_MS + 10_000);
          if (token !== this.pollToken) return;
          await this.serial(() => this.reconcile(at, reply));
        } catch (err) {
          await this.patchState({ message: String((err as Error).message ?? err) }).catch(() => undefined);
          await sleep(10_000);
        }
      }
    })();
  }

  private async reconcile(config: LanConfig, reply: Reply): Promise<void> {
    let phone = reply.phone;
    const state = await this.state();
    const ok = { lastOkAt: Date.now(), rev: phone.rev, phone };
    if (!phone.connected) {
      await this.patchState({ ...ok, message: "Open Curbox Sync on your phone and allow it in Curbox." });
      return;
    }
    // The phone stamps changes with its own clock.
    const skew = reply.now - Date.now();
    const local = localView(await activeSession());
    const remote = phoneView(phone);
    const localChangedAt = await read(K_LOCAL_CHANGED, 0);
    const action = decide(local, remote, state.last, localChangedAt, phone.changedAt - skew);
    let message = state.note ?? "";
    if (action !== "none") message = "";

    if (action === "push") {
      const res = await this.call(config, { op: "focus", focus: local });
      phone = res.phone;
      if (res.result === "locked") {
        message = "Focus on your phone cannot be ended early, so I kept it on here too.";
        await this.follow(phone);
      } else if (res.result === "no_group") {
        message = `Your phone has no focus group named ${local.name}. Make one with that name in Curbox to share it.`;
      } else if (res.result === "failed" || res.result === "unavailable") {
        message = "Your phone could not change focus mode.";
      }
    } else if (action === "pull") {
      message = await this.follow(phone);
    }

    const after = localView(await get("focus"));
    await this.patchState({ ...ok, rev: phone.rev, phone, last: { local: after, phone: phoneView(phone) }, message: "", note: message });
  }

  /** Makes the browser match the phone. Returns a note for the user, or "". */
  private async follow(phone: PhoneState): Promise<string> {
    const remote = phoneView(phone);
    if (!remote.active) {
      if (localView(await get("focus")).active) await endSession();
      return "";
    }
    const groups = (await get("settings")).focusGroups ?? [];
    let group = groups.find((g) => g.id === remote.groupId) ?? groups.find((g) => sameGroup(g, { name: remote.name }));
    let note = "";
    if (!group) {
      // The phone API only shares a group's name and mode, not its apps or sites,
      // so the browser gets an empty group of the same name to fill in.
      const source = phone.groups.find((g) => g.id === remote.groupId);
      const created: FocusGroup = {
        id: remote.groupId || toHex(randomBytes(16)),
        name: remote.name || "Focus",
        domains: [],
        mode: source?.blockMode === "BLOCK_ALL_EXCEPT_SELECTED" ? "all-except" : "only-these",
        exitable: source?.exitable ?? phone.exitable,
      };
      await update("settings", (s) => ({ ...s, focusGroups: [...(s.focusGroups ?? []), created] }));
      group = created;
      note = `I added ${created.name} from your phone to your focus groups. Add the sites it should hold back.`;
    }
    await startSessionUntil(group, remote.endsAt, phone.exitable);
    return note;
  }
}

let engine: LanSync | null = null;
export const getLanSync = () => (engine ??= new LanSync());
