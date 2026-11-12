import { browser } from "#imports";
import { fromBase64Url, randomBytes, toBase64Url, toHex } from "../crypto";
import { get, getUsage, set, update } from "../storage";
import { lastNDays } from "../time";
import { activeSession, endSession, startSessionUntil } from "../../core/focus";
import { deriveLanKey, normalizeCode, CODE_LENGTH, open, REQUEST_AAD, responseAad, seal } from "./crypto";
import type { FocusGroup, FocusSession, PomodoroState } from "../types";
import { localGroupsHash, planGroups, settle, type GroupLink } from "./groups";
import { candidateSubnets } from "./link";
import { codeKey, decodeShort, ecdhPair, ecdhShared, pairProof, sameProof, sessionKey, shortCandidates } from "./shortcode";
import { decide, hasCap, localView, phoneView, sameFocus, sameGroup, settling, type FocusView, type PhoneGroup, type PhoneState } from "./reconcile";
import { changedDays, clientName, DAYS_PER_REQUEST, USAGE_DAYS, usageDays } from "./usage";

// Focus mode sync with Curbox on an Android phone over the local WiFi, through
// the CurboxSync companion app. The phone runs the server; this side decides
// which device moved and makes the other one follow. See CurboxSync/PROTOCOL.md.

export const LAN_PORT = 47621;
const K_CONFIG = "lan.config";
const K_STATE = "lan.state";
const K_LOCAL_CHANGED = "lan.localChangedAt";
const K_LAST_ADDRESS = "lan.lastAddress";
const K_PLACES = "lan.places";
const K_USAGE = "lan.usage";
const K_CLIENT = "lan.clientId";
const K_HINT = "lan.hint";
const K_GROUPS = "lan.groups";
const K_DEVICE = "lan.device";
const SETTLE_RETRY_MS = 20_000;
const ROAM_REST_MS = 5 * 60_000;
/** Per address in a sweep; the phone holds a WiFi lock, so it answers well inside this. */
const PROBE_MS = 2_000;
/** Usage only feeds the phone's usage screen, so it rides along with a round at most this often. */
const USAGE_EVERY_MS = 15 * 60_000;
const WAIT_MS = 25_000;
/**
 * Battery: every request wakes the phone. With its screen off nothing there changes by hand, so the
 * phone is asked only on a local change, on coming back to this computer, and this often meanwhile.
 * While its screen is on (its radio is awake anyway) a long poll keeps phone changes instant.
 */
const QUIET_EVERY_MS = 5 * 60_000;
/** Back at the computer: a round, unless one ran this recently. */
const RETURN_GAP_MS = 20_000;

interface LanConfig {
  address: string;
  key: string;
  /** The phone's Tailscale address, learned from its replies. Reaches it from any network. */
  tailnet?: string;
}

/** The Tailscale hello also wakes the phone; it only feeds the panel, so rarely unless the panel asks. */
const TAILNET_CHECK_MS = 60 * 60_000;
const TAILNET_PANEL_MS = 5 * 60_000;

/** 100.64.0.0/10, the range Tailscale hands out. */
export function isTailnetAddress(address: string): boolean {
  const m = address.match(/^100\.(\d{1,3})\./);
  return !!m && Number(m[1]) >= 64 && Number(m[1]) <= 127;
}

interface LanState {
  last: { local: FocusView; phone: FocusView } | null;
  rev: number;
  lastOkAt: number;
  phone: PhoneState | null;
  /** Connection problems; cleared by the next good round. */
  message: string;
  /** Last time the phone answered on its Tailscale address, and last time that was tried. */
  tailnetOkAt?: number;
  tailnetCheckedAt?: number;
  /** Outcome of the last sync step; kept until another step runs. */
  note?: string;
  /** Proto 4: the phone's screen was on at the last reply. Older phones never say, so stay quiet. */
  awake?: boolean;
  /** Last time a round was tried, good or not; paces retries. */
  triedAt?: number;
  /** This computer's idle state as last seen, so a worker restart is not mistaken for a return. */
  machine?: "active" | "idle" | "locked";
}

interface Reply {
  ok: boolean;
  phone: PhoneState;
  result?: string;
  now: number;
  /** Proto 2: the network the phone is on. */
  net?: { id: string; label: string; address: string };
  /** The phone's Tailscale address, while Tailscale is on there. */
  tailnet?: string;
  /** Proto 2, `usage` replies: the totals the phone holds for this browser. */
  known?: Record<string, number>;
  /** Proto 3, `groups` and `saveGroups` replies: every focus group with its websites. */
  groups?: PhoneGroup[];
  /** Proto 3, `saveGroups` replies: the outcome for each group id. */
  results?: Record<string, string>;
  error?: string;
  /** Which phone answered. Paired phones share browser keys, so the same key can reach another phone. */
  device?: { id: string; name: string };
  /** Proto 4: whether the phone's screen is on. */
  awake?: boolean;
}

/** The phone's address on one network, so it is found again after a move. */
export interface LanPlace {
  id: string;
  label: string;
  address: string;
  lastOkAt: number;
}

interface GroupSync {
  /** Which pairing the links belong to. */
  key: string;
  links: GroupLink[];
  /** Hashes both sides had after the last complete round; "" forces another round. */
  phoneHash: string;
  localHash: string;
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
  /** Networks this browser has met the phone on, newest first. */
  places: LanPlace[];
  /** The network the phone was last seen on. */
  placeId: string;
  usageSentAt: number;
  /** How the phone is reached right now. */
  via: "wifi" | "tailscale";
  /**
   * Tailscale, in one word: "off" (the phone has never reported it), "phone" (on the phone but this
   * computer cannot reach it, so Tailscale is off here), or "on" (works from anywhere).
   */
  tailscale: "off" | "checking" | "phone" | "on";
  tailnetAddress: string;
}

export type LanRequest =
  | { type: "lan:status" }
  | { type: "lan:pairCode"; code: string; hint: string | null }
  | { type: "lan:hint"; hint: string | null }
  | { type: "lan:unpair" }
  | { type: "lan:syncNow" }
  | { type: "lan:search" }
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
    throw new LanError("unreachable", "I cannot reach your phone. Make sure both are on the same WiFi (or both on Tailscale) and Curbox Sync is on.");
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


/** The first address whose phone is ready to pair (Curbox Sync open), with its public key. */
async function firstPairingPhone(candidates: string[]): Promise<{ address: string; pub: string } | null> {
  const ask = async (address: string) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4_000);
    try {
      const res = await fetch(`http://${address}/v1/pair`, { cache: "no-store", signal: ctrl.signal });
      if (res.status === 403) throw new LanError("code", "Open Curbox Sync on your phone, then type the code again.");
      const body = (await res.json()) as { pub?: string };
      if (!res.ok || !body.pub) throw new Error("not a phone");
      return { address, pub: body.pub };
    } finally {
      clearTimeout(timer);
    }
  };
  try {
    return await Promise.any(candidates.map(ask));
  } catch (err) {
    const closed = (err as AggregateError).errors?.find((e) => e instanceof LanError);
    if (closed) throw closed;
    return null;
  }
}

/** Finds Curbox Sync in a /24, stopping at the first phone that answers. */
function sweepSubnet(subnet: string): Promise<string[]> {
  return probeAll(Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}:${LAN_PORT}`), { first: true });
}

/**
 * Returns the addresses that answer like Curbox Sync. With `first`, returns as soon as one does and
 * drops the rest, so a sweep does not wait out every empty address's timeout.
 */
async function probeAll(
  hosts: string[],
  { concurrency = 48, timeoutMs = PROBE_MS, first = false } = {},
): Promise<string[]> {
  const found: string[] = [];
  const stop = new AbortController();
  const probe = async (address: string) => {
    const ctrl = new AbortController();
    const onStop = () => ctrl.abort();
    stop.signal.addEventListener("abort", onStop);
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(`http://${address}/v1/hello`, { cache: "no-store", signal: ctrl.signal });
      if (res.ok && ((await res.json()) as { app?: string }).app === "curbox-sync") {
        found.push(address);
        if (first) stop.abort();
      }
    } catch {
      // Nothing there.
    } finally {
      clearTimeout(timer);
      stop.signal.removeEventListener("abort", onStop);
    }
  };
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, hosts.length) }, async () => {
      while (next < hosts.length && !stop.signal.aborted) await probe(hosts[next++]);
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

  /** Worker start. The worker restarts often, so this only does what the tick would. */
  async start(): Promise<void> {
    await this.onTick();
  }

  /**
   * The 30 s alarm. Asks the phone only when a round is due, so an idle phone stays asleep:
   * never while this computer is idle or locked, every [QUIET_EVERY_MS] while the phone's screen
   * is off, and through a long poll while it is on.
   */
  async onTick(): Promise<void> {
    if (!(await this.config())) return;
    const state = await this.state();
    if ((state.machine ?? "active") !== "active") return;
    const now = Date.now();
    if (state.awake && now - state.lastOkAt < 2 * 60_000) {
      // Revives the long poll after the worker slept.
      if (!this.polling) this.startPolling();
      return;
    }
    if (now - Math.max(state.lastOkAt, state.triedAt ?? 0) < QUIET_EVERY_MS) return;
    await this.syncNow().catch(() => undefined);
  }

  /**
   * chrome.idle changed. Someone cannot work the computer and the phone at once, so a focus change
   * made on the phone is caught when they come back here, at no cost while they are away.
   */
  async onMachineState(machine: "active" | "idle" | "locked"): Promise<void> {
    if (!(await this.config())) return;
    const state = await this.state();
    if (state.machine === machine) return;
    await this.patchState({ machine });
    if (machine !== "active") {
      this.pollToken++;
      return;
    }
    if (Date.now() - Math.max(state.lastOkAt, state.triedAt ?? 0) < RETURN_GAP_MS) return;
    await this.syncNow().catch(() => undefined);
  }

  async status(): Promise<LanStatus> {
    const [config, state, places, usage] = await Promise.all([
      this.config(), this.state(), this.places(), read<UsageSync | null>(K_USAGE, null),
    ]);
    // The panel is open, so its Tailscale line is worth a fresher check.
    if (config) void this.checkTailnet(config, TAILNET_PANEL_MS).catch(() => undefined);
    return {
      paired: config !== null,
      address: config?.address ?? "",
      reachable: Date.now() - state.lastOkAt < 60_000,
      lastOkAt: state.lastOkAt,
      phone: state.phone,
      message: state.message || state.note || "",
      places,
      placeId: places.find((p) => p.address === config?.address)?.id ?? "",
      usageSentAt: config && usage?.key.split("|")[0] === config.key ? usage.sentAt : 0,
      via: config && isTailnetAddress(config.address) ? "tailscale" : "wifi",
      tailscale: !config?.tailnet
        ? "off"
        : config.address === config.tailnet || (state.tailnetOkAt ?? 0) > 0
          ? "on"
          : state.tailnetCheckedAt
            ? "phone"
            : "checking",
      tailnetAddress: config?.tailnet ?? "",
    };
  }

  private async places(): Promise<LanPlace[]> {
    const places = await read<LanPlace[]>(K_PLACES, []);
    return [...places].sort((a, b) => b.lastOkAt - a.lastOkAt);
  }

  private async notePlace(config: LanConfig, reply: Reply): Promise<void> {
    if (reply.tailnet && reply.tailnet !== config.tailnet) await this.noteTailnet(config, reply.tailnet);
    if (!reply.net?.id) return;
    // Over Tailscale the browser is not on the phone's WiFi; keep the phone's own address for that place.
    const address = isTailnetAddress(config.address) ? reply.net.address : config.address;
    if (!address) return;
    const places = await this.places();
    const old = places.find((p) => p.id === reply.net!.id);
    // Rewrite only when something visible changed, or once a minute.
    if (old && old.address === address && old.label === reply.net.label && Date.now() - old.lastOkAt < 60_000) return;
    const place: LanPlace = { id: reply.net.id, label: reply.net.label, address, lastOkAt: Date.now() };
    await write(K_PLACES, [place, ...places.filter((p) => p.id !== place.id)].slice(0, 12));
  }

  /** The phone turned Tailscale on, or got a new address there. Saved to the pairing, not as a place. */
  private async noteTailnet(config: LanConfig, tailnet: string): Promise<void> {
    if (!isTailnetAddress(tailnet)) return;
    const current = await this.config();
    if (!current || current.key !== config.key) return;
    await write(K_CONFIG, { ...current, tailnet });
    await this.patchState({ tailnetCheckedAt: 0 });
  }

  private tailnetBusy = false;

  /**
   * While WiFi works, checks now and then that Tailscale would too, so the panel can say whether
   * sync keeps going after leaving this WiFi. A plain hello, no key needed.
   */
  private async checkTailnet(config: LanConfig, every = TAILNET_CHECK_MS): Promise<void> {
    if (!config.tailnet || config.address === config.tailnet || this.tailnetBusy) return;
    const state = await this.state();
    if (Date.now() - (state.tailnetCheckedAt ?? 0) < every) return;
    this.tailnetBusy = true;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2_500);
    try {
      const res = await fetch(`http://${config.tailnet}/v1/hello`, { cache: "no-store", signal: ctrl.signal }).catch(() => null);
      const ok = !!res?.ok && ((await res.json().catch(() => ({}))) as { app?: string }).app === "curbox-sync";
      const now = Date.now();
      await this.patchState(ok ? { tailnetOkAt: now, tailnetCheckedAt: now } : { tailnetOkAt: 0, tailnetCheckedAt: now });
    } finally {
      clearTimeout(timer);
      this.tailnetBusy = false;
    }
  }

  /** "Find my phone": skips the rest between searches and looks again right away. */
  async searchNow(): Promise<void> {
    this.roamRound = 0;
    this.roamRestUntil = 0;
    const state = await this.state();
    if (state.tailnetCheckedAt) await this.patchState({ tailnetCheckedAt: 0 });
    await this.syncNow();
  }

  async forgetPlace(id: string): Promise<void> {
    await write(K_PLACES, (await this.places()).filter((p) => p.id !== id));
  }

  /** Sends a request to the paired phone and remembers which network answered. */
  /** The phone that last answered; group links and usage totals belong to one phone. */
  private device: string | null = null;

  private async syncScope(config: LanConfig): Promise<string> {
    this.device ??= await read<string>(K_DEVICE, "");
    return this.device ? `${config.key}|${this.device}` : config.key;
  }

  private async call(config: LanConfig, body: Record<string, unknown>, timeoutMs?: number): Promise<Reply> {
    const reply = await rpc(config, body, timeoutMs);
    if (reply.device?.id && reply.device.id !== this.device) {
      this.device = reply.device.id;
      await write(K_DEVICE, this.device);
    }
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
      await this.call(moved, { op: "state" }, 5_000);
      return moved;
    };
    // Tailscale reaches the phone from any network, so it goes in with the saved WiFi addresses.
    const saved = [...new Set([...(config.tailnet ? [config.tailnet] : []), ...places.map((p) => p.address)])].filter(
      (a) => a !== config.address,
    );
    if (saved.length) {
      const found = await Promise.any(saved.map(tryAt)).catch(() => null);
      if (found) return await this.moveTo(found);
    }
    const hint = await read<string | null>(K_HINT, null);
    const subnets = candidateSubnets(hint, config.address, ...places.map((p) => p.address));
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

  /** This computer's own address, from the panel. A new range means a new network, so search right away. */
  async setHint(hint: string | null): Promise<void> {
    if (!hint) return;
    const old = await read<string | null>(K_HINT, null);
    if (old === hint) return;
    await write(K_HINT, hint);
    this.roamRound = 0;
    this.roamRestUntil = 0;
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

  /** Shares this browser's daily site totals with the phone, at most every [USAGE_EVERY_MS]. */
  private async pushUsage(config: LanConfig): Promise<void> {
    if (this.usageBusy) return;
    let sync = await read<UsageSync | null>(K_USAGE, null);
    if (!sync || sync.key !== (await this.syncScope(config))) sync = { key: (await this.syncScope(config)), known: null, sentAt: 0 };
    if (Date.now() - sync.sentAt < USAGE_EVERY_MS) return;
    this.usageBusy = true;
    try {
      const clientId = await this.clientId();
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
        sync = { key: (await this.syncScope(config)), known: reply.known, sentAt: Date.now() };
        pending = pending.slice(batch.length);
      } while (pending.length && ++rounds < 4);
      await write(K_USAGE, sync);
    } finally {
      this.usageBusy = false;
    }
  }

  /**
   * Pairs with the short code Curbox Sync shows. The code says where the phone is, so this knocks
   * on a handful of addresses at once instead of searching the network.
   */
  async pairCode(code: string, hint: string | null): Promise<void> {
    if (!decodeShort(code)) throw new LanError("bad", "The code has 6 letters and numbers. You can see it in Curbox Sync on your phone.");
    if (hint) await this.setHint(hint);
    const [lastAddress, places] = await Promise.all([read<string | null>(K_LAST_ADDRESS, null), this.places()]);
    const candidates = shortCandidates(code, LAN_PORT, hint, await read<string | null>(K_HINT, null), lastAddress, ...places.map((p) => p.address));
    const phone = await firstPairingPhone(candidates);
    if (!phone) {
      throw new LanError(
        "unreachable",
        "I could not find your phone. Keep Curbox Sync open on it, and check both are on the same WiFi.",
      );
    }
    const kCode = await codeKey(code);
    const { keys, pub } = await ecdhPair();
    const res = await fetch(`http://${phone.address}/v1/pair`, {
      method: "POST",
      headers: { "content-type": "text/plain" },
      cache: "no-store",
      body: JSON.stringify({
        pub,
        proof: await pairProof(kCode, "b", phone.pub, pub),
        from: { id: await this.clientId(), name: clientName(), kind: "browser" },
      }),
    }).catch(() => null);
    if (!res) throw new LanError("unreachable", "Your phone stopped answering. Try again.");
    if (res.status === 401) throw new LanError("code", "That code did not match. Check it on your phone and try again.");
    if (res.status === 403) throw new LanError("code", "Open Curbox Sync on your phone, then type the code again.");
    if (!res.ok) throw new LanError("unreachable", "Your phone answered in a way I did not expect.");
    const reply = (await res.json()) as { proof?: string };
    if (!reply.proof || !sameProof(reply.proof, await pairProof(kCode, "p", phone.pub, pub))) {
      throw new LanError("code", "That phone could not prove it showed this code. Try again.");
    }
    const key = await sessionKey(await ecdhShared(keys.privateKey, phone.pub), kCode, phone.pub, pub);
    await this.unpair();
    await this.adopt({ address: phone.address, key: toBase64Url(key) });
  }

  private async clientId(): Promise<string> {
    let id = await read<string | null>(K_CLIENT, null);
    if (!id) await write(K_CLIENT, (id = toHex(randomBytes(12))));
    return id;
  }

  /** Confirms the phone opens our sealed requests, then saves it as the paired phone. */
  private async adopt(config: LanConfig, keepState = false): Promise<void> {
    const first = await this.call(config, { op: "state" }, 8_000);
    this.pollToken++;
    await write(K_CONFIG, config);
    await write(K_LAST_ADDRESS, config.address);
    // The phone already answered, so pairing worked even if the first sync does not.
    // Adding a network keeps the agreed focus view, so nothing is undone.
    const base = keepState ? await this.state() : EMPTY_STATE;
    await write(K_STATE, { ...base, lastOkAt: Date.now(), phone: first.phone, message: "" });
    await this.syncNow().catch(() => undefined);
  }

  /** Pairs with an address and the code shown on the phone, typed by hand. */
  async pair(address: string, code: string): Promise<void> {
    const normalized = normalizeCode(code);
    if (normalized.length !== CODE_LENGTH) throw new LanError("bad", "The pairing code has 12 letters and numbers.");
    await this.adopt({ address: normalizeAddress(address), key: toBase64Url(await deriveLanKey(normalized)) });
  }

  async unpair(): Promise<void> {
    this.pollToken++;
    const config = await this.config();
    if (config) await write(K_LAST_ADDRESS, config.address);
    this.device = null;
    await browser.storage.local.remove([K_CONFIG, K_STATE, K_LOCAL_CHANGED, K_USAGE, K_GROUPS, K_DEVICE]);
  }

  /** Called whenever settings change; shares focus group edits with the phone. */
  async onLocalSettingsChanged(groups: readonly FocusGroup[]): Promise<void> {
    const config = await this.config();
    if (!config) return;
    const sync = await read<GroupSync | null>(K_GROUPS, null);
    if (!sync || sync.key !== (await this.syncScope(config)) || sync.localHash === localGroupsHash(groups)) return;
    if (!hasCap((await this.state()).phone, "groups")) return;
    await this.syncNow().catch(() => undefined);
  }

  /**
   * Shares focus groups both ways when either side changed them, before focus
   * is reconciled, so a session can always find its group on the other side.
   * Returns the phone state after any changes.
   */
  private async shareGroups(config: LanConfig, phone: PhoneState): Promise<PhoneState> {
    if (!hasCap(phone, "groups")) return phone;
    const settings = await get("settings");
    const locals = settings.focusGroups ?? [];
    let sync = await read<GroupSync | null>(K_GROUPS, null);
    if (sync && sync.key !== (await this.syncScope(config))) sync = null;
    if (sync && sync.phoneHash === phone.groupsHash && sync.localHash === localGroupsHash(locals)) return phone;

    const listed = await this.call(config, { op: "groups" });
    const phones = listed.groups ?? [];
    phone = listed.phone;
    // A session that cannot be ended early keeps its group as it is until it ends.
    const session = await activeSession();
    const frozen = new Set<string>();
    if (session && !session.exitable) frozen.add(session.groupId);
    if (phone.active && !phone.exitable && phone.endsAt > Date.now()) frozen.add(phone.groupId);
    const plan = planGroups(locals, phones, sync?.links ?? null, frozen);

    if (plan.upsert.length || plan.remove.length) {
      const byId = new Map(plan.upsert.map((g) => [g.id, g]));
      await update("settings", (s) => {
        const current = s.focusGroups ?? [];
        const kept = current.filter((g) => !plan.remove.includes(g.id)).map((g) => byId.get(g.id) ?? g);
        const added = plan.upsert.filter((g) => !current.some((c) => c.id === g.id));
        return { ...s, focusGroups: [...kept, ...added] };
      });
      // A running session picks up its group's new sites, as it does on the phone.
      const changed = session && session.exitable ? byId.get(session.groupId) : undefined;
      if (changed) await this.patchSession(session!, { name: changed.name, domains: changed.domains, mode: changed.mode });
    }

    let results: Record<string, string> = {};
    if (plan.save.length || plan.delete.length) {
      const saved = await this.call(config, { op: "saveGroups", save: plan.save, delete: plan.delete });
      results = saved.results ?? {};
      phone = saved.phone;
    }
    const links = settle(plan, results);
    const refused = [...plan.save.map((g) => g.id), ...plan.delete].some((id) => results[id] !== "applied" && results[id] !== "noop");
    const after = (await get("settings")).focusGroups ?? [];
    await write(K_GROUPS, {
      key: (await this.syncScope(config)),
      links,
      // Something waits (a refused edit, or a locked group); look again next round.
      phoneHash: refused || frozen.size ? "" : (phone.groupsHash ?? ""),
      localHash: localGroupsHash(after),
    } satisfies GroupSync);
    return phone;
  }

  /** Updates the running session's sites. Its group and end stay the same, so nothing is pushed. */
  private async patchSession(session: FocusSession, change: Partial<FocusSession>): Promise<void> {
    const current = await get("focus");
    if (!current || current.startedAt !== session.startedAt) return;
    await set("focus", { ...current, ...change });
  }

  /** Called whenever the local focus key changes. */
  async onLocalFocusChanged(): Promise<void> {
    if (!(await this.config())) return;
    await write(K_LOCAL_CHANGED, Date.now());
    await this.syncNow().catch(() => undefined);
  }

  /** Reads the phone and reconciles once, then long polls if the phone's screen is on. */
  async syncNow(): Promise<void> {
    const config = await this.config();
    if (!config) return;
    const reached = await this.serial(async () => {
      try {
        await this.patchState({ triedAt: Date.now() });
        const r = await this.reach(config, { op: "state" });
        await this.reconcile(r.config, r.reply);
        return r.config;
      } catch (err) {
        await this.patchState({ message: String((err as Error).message ?? err) });
        throw err;
      }
    });
    void this.pushUsage(reached).catch(() => undefined);
    if (!this.polling && (await this.holdOpen())) this.startPolling();
  }

  /** The running long poll's token; it is stale once anything bumps [pollToken]. */
  private loopToken = 0;

  private get polling(): boolean {
    return this.loopToken !== 0 && this.loopToken === this.pollToken;
  }

  /** Long poll only while it is nearly free: the phone's screen is on and someone is at this computer. */
  private async holdOpen(): Promise<boolean> {
    const state = await this.state();
    return !!state.awake && (state.machine ?? "active") === "active";
  }

  // Long poll: the phone answers as soon as its focus changes, its screen goes off, or after 25s.
  // It ends with the screen, with this computer going idle, or on the first failure (the tick retries).
  private startPolling(): void {
    const token = ++this.pollToken;
    this.loopToken = token;
    void (async () => {
      try {
        while (token === this.pollToken && (await this.holdOpen())) {
          const config = await this.config();
          if (!config) return;
          const { rev } = await this.state();
          const { config: at, reply } = await this.reach(config, { op: "wait", since: rev, wait: WAIT_MS }, WAIT_MS + 10_000);
          if (token !== this.pollToken) return;
          await this.serial(() => this.reconcile(at, reply));
        }
      } catch (err) {
        await this.patchState({ message: String((err as Error).message ?? err), awake: false }).catch(() => undefined);
      } finally {
        if (this.loopToken === token) this.loopToken = 0;
      }
    })();
  }

  private async reconcile(config: LanConfig, reply: Reply): Promise<void> {
    let phone = reply.phone;
    const state = await this.state();
    const ok = { lastOkAt: Date.now(), rev: phone.rev, phone, awake: reply.awake === true };
    void this.checkTailnet(config).catch(() => undefined);
    if (!phone.connected) {
      await this.patchState({ ...ok, message: "Open Curbox Sync on your phone and allow it in Curbox." });
      return;
    }
    try {
      phone = await this.shareGroups(config, phone);
    } catch {
      // Focus still syncs when group sharing hits a problem; groups are tried again next round.
    }
    // The phone stamps changes with its own clock.
    const skew = reply.now - Date.now();
    const cycles = hasCap(phone, "pomodoro");
    const local = localView(await activeSession(), Date.now(), cycles);
    const remote = phoneView(phone);
    if (!sameFocus(local, remote) && (settling(local) || settling(remote))) {
      // A phase or session is ending on both devices at once; look again once both moved on.
      await this.patchState({ ...ok, rev: phone.rev, phone });
      this.retrySoon();
      return;
    }
    const localChangedAt = await read(K_LOCAL_CHANGED, 0);
    const action = decide(local, remote, state.last, localChangedAt, phone.changedAt - skew);
    let message = state.note ?? "";
    if (action !== "none") message = "";

    if (action === "push") {
      const focus = { ...local, pomodoro: local.pomodoro && { ...local.pomodoro, phase: local.phase } };
      const res = await this.call(config, { op: "focus", focus });
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

    const after = localView(await get("focus"), Date.now(), cycles);
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
    const p = remote.pomodoro;
    const pomodoro: PomodoroState | undefined = p && {
      phase: remote.phase === "break" ? "break" : "focus",
      focusMinutes: p.focusMinutes,
      breakMinutes: p.breakMinutes,
      totalRounds: p.rounds,
      completedRounds: p.completed,
    };
    await startSessionUntil(group, remote.endsAt, phone.exitable, pomodoro);
    return note;
  }

  private retryTimer: ReturnType<typeof setTimeout> | null = null;

  private retrySoon(): void {
    if (this.retryTimer) return;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      void this.syncNow().catch(() => undefined);
    }, SETTLE_RETRY_MS);
  }
}

let engine: LanSync | null = null;
export const getLanSync = () => (engine ??= new LanSync());
