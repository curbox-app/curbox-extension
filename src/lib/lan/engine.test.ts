import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "#imports";
import { get, set, usageKey } from "../storage";
import { todayKey } from "../time";
import { newFocusGroup } from "../types";
import { open, REQUEST_AAD, responseAad, seal, deriveLanKey } from "./crypto";
import { LanSync } from "./engine";
import { codeKey, ecdhPair, ecdhShared, encodeShort, formatShort, pairProof, sameProof, sessionKey } from "./shortcode";
import type { PhoneState } from "./reconcile";

const CODE = "ABCDEFGHJKMN";

// A stand in for CurboxSync that speaks the real sealed protocol.
function fakePhone(key: Uint8Array) {
  const phone: PhoneState = {
    connected: true, apiVersion: 4, active: false, groupId: "", name: "", endsAt: 0, exitable: true,
    exact: true, changedAt: Date.now(), rev: 1, groups: [{ id: "p1", name: "Study", exitable: true }],
  };
  const calls: string[] = [];
  const usage: { date: string; totalMs: number }[] = [];
  const net = { id: "192.168.1.0/24@192.168.1.1", label: "Home" };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const req = JSON.parse(await open(key, REQUEST_AAD, String(init.body)));
    calls.push(req.op);
    const reply: Record<string, unknown> = { ok: true, now: Date.now() };
    if (req.op === "focus") {
      const f = req.focus;
      if (f.active) Object.assign(phone, { active: true, groupId: "p1", name: "Study", endsAt: f.endsAt });
      else Object.assign(phone, { active: false, groupId: "", name: "", endsAt: 0 });
      phone.rev++;
      phone.changedAt = Date.now();
      reply.result = "applied";
    }
    if (req.op === "wait") await new Promise(() => undefined); // never answers in tests
    if (req.op === "usage") {
      usage.push(...req.days);
      reply.known = Object.fromEntries(usage.map((d: { date: string; totalMs: number }) => [d.date, d.totalMs]));
    }
    reply.net = { id: net.id, label: net.label, address: "" };
    reply.phone = { ...phone };
    return new Response(await seal(key, responseAad(req.id), JSON.stringify(reply)), { status: 200 });
  });
  return { phone, calls, fetchMock, usage, net };
}

// The phone's side of the short code handshake, as CurboxSync does it.
async function pairingPhone(code: string) {
  const { keys, pub } = await ecdhPair();
  const kCode = await codeKey(code);
  const self = {
    key: null as Uint8Array | null,
    async handle(init?: RequestInit): Promise<Response> {
      if (!init || init.method !== "POST") return new Response(JSON.stringify({ pub }));
      const req = JSON.parse(String(init.body)) as { pub: string; proof: string };
      if (!sameProof(req.proof, await pairProof(kCode, "b", pub, req.pub))) return new Response("", { status: 401 });
      self.key = await sessionKey(await ecdhShared(keys.privateKey, req.pub), kCode, pub, req.pub);
      return new Response(JSON.stringify({ proof: await pairProof(kCode, "p", pub, req.pub), id: "phone1", name: "Pixel" }));
    },
  };
  return self;
}

describe("lan engine", () => {
  let fake: ReturnType<typeof fakePhone>;

  beforeEach(async () => {
    browser.storage.local.clear();
    fake = fakePhone(await deriveLanKey(CODE));
    vi.stubGlobal("fetch", fake.fetchMock);
    const settings = await get("settings");
    await set("settings", { ...settings, focusGroups: [{ ...newFocusGroup("study"), id: "e1" }] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("starts focus in the browser when the phone starts it", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    Object.assign(fake.phone, { active: true, groupId: "p1", name: "Study", endsAt: Date.now() + 20 * 60_000 });
    fake.phone.rev++;
    fake.phone.changedAt = Date.now();
    await lan.syncNow();
    const focus = await get("focus");
    expect(focus?.groupId).toBe("e1");
    expect(focus?.endsAt).toBe(fake.phone.endsAt);
  });

  it("adds a phone group the browser lacks and still starts focus", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    fake.phone.groups.push({ id: "p2", name: "group", exitable: true, blockMode: "BLOCK_SELECTED" });
    Object.assign(fake.phone, { active: true, groupId: "p2", name: "group", endsAt: Date.now() + 20 * 60_000 });
    fake.phone.rev++;
    fake.phone.changedAt = Date.now();
    await lan.syncNow();
    expect((await get("focus"))?.groupId).toBe("p2");
    expect((await get("settings")).focusGroups.map((g) => g.name)).toContain("group");
    await lan.syncNow();
    expect((await lan.status()).message).toContain("I added group");
  });

  it("pairs with the short code the phone shows", async () => {
    const shown = encodeShort(1, 77, 4321);
    const phone = await pairingPhone(shown);
    let sealed: ReturnType<typeof fakePhone> | null = null;
    const knocked: string[] = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      knocked.push(url);
      if (!url.startsWith("http://192.168.1.77:")) throw new TypeError("unreachable");
      if (url.endsWith("/v1/pair")) {
        const res = await phone.handle(init);
        if (phone.key) sealed = fakePhone(phone.key);
        return res;
      }
      return sealed!.fetchMock(url, init!);
    });
    const lan = new LanSync();
    await expect(lan.pairCode(encodeShort(1, 77, 1234), "192.168.1.9")).rejects.toThrow(/did not match/);
    await lan.pairCode(formatShort(shown).toLowerCase(), "192.168.1.9");
    const status = await lan.status();
    expect(status.paired).toBe(true);
    expect(status.address).toBe("192.168.1.77:47621");
    // Goes straight to the address in the code: no network sweep.
    expect(knocked.filter((u) => u.endsWith("/v1/hello"))).toHaveLength(0);
  });

  it("says when Curbox Sync is not open on the phone", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      if (!url.startsWith("http://192.168.1.77:")) throw new TypeError("unreachable");
      return new Response("", { status: 403 });
    });
    await expect(new LanSync().pairCode(encodeShort(1, 77, 9), null)).rejects.toThrow(/Open Curbox Sync/);
  });

  it("starts focus on the phone when the browser starts it", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    const groups = (await get("settings")).focusGroups;
    const { startSession } = await import("../../core/focus");
    await startSession(groups[0], 25, true);
    await lan.onLocalFocusChanged();
    expect(fake.phone.active).toBe(true);
  });

  it("follows the phone to another network", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    expect((await lan.status()).places.map((p) => p.label)).toEqual(["Home"]);
    // The phone was seen at the office before.
    await browser.storage.local.set({
      "lan.places": [...(await lan.status()).places, { id: "10.0.0.0/24@10.0.0.1", label: "Office", address: "10.0.0.42:47621", lastOkAt: 1 }],
    });
    // Now it moved to the office WiFi and only answers there.
    fake.net.id = "10.0.0.0/24@10.0.0.1";
    fake.net.label = "Office";
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (!url.startsWith("http://10.0.0.42:")) throw new TypeError("unreachable");
      if (url.endsWith("/v1/hello")) return new Response('{"app":"curbox-sync","proto":2}');
      return fake.fetchMock(url, init);
    });
    await lan.syncNow();
    const status = await lan.status();
    expect(status.address).toBe("10.0.0.42:47621");
    expect(status.places[0].label).toBe("Office");
  });

  it("shares daily site totals with the phone", async () => {
    await browser.storage.local.set({ [usageKey(todayKey())]: { "a.com": { ms: 300_000, paths: {} } } });
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    for (let i = 0; i < 20 && !fake.usage.length; i++) await new Promise((r) => setTimeout(r, 20));
    expect(fake.usage).toEqual([{ date: todayKey(), totalMs: 300_000, sites: [{ domain: "a.com", ms: 300_000 }] }]);
    expect((await lan.status()).usageSentAt).toBeGreaterThan(0);
  });

  it("stays paired when the first sync after pairing fails", async () => {
    let calls = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (++calls > 1) throw new TypeError("network went away");
      return fake.fetchMock(url, init);
    });
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    const status = await lan.status();
    expect(status.paired).toBe(true);
    expect(status.lastOkAt).toBeGreaterThan(0);
  });
});
