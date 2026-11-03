import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "#imports";
import { get, set, usageKey } from "../storage";
import { todayKey } from "../time";
import { newFocusGroup } from "../types";
import { open, REQUEST_AAD, responseAad, seal, deriveLanKey } from "./crypto";
import { LanSync } from "./engine";
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

  it("finds the phone on the WiFi once it scans the browser code", async () => {
    let phone: ReturnType<typeof fakePhone> | null = null;
    let syncOn = false;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      if (!syncOn || !url.startsWith("http://192.168.1.77:")) throw new TypeError("unreachable");
      if (url.endsWith("/v1/hello")) return new Response('{"app":"curbox-sync","proto":1}');
      if (!phone) return new Response("", { status: 401 });
      return phone.fetchMock(url, init);
    });
    const lan = new LanSync();
    await lan.startPairing("192.168.1.9");
    const link = (await lan.status()).pairingLink!;
    const code = new URL(link.replace("curboxsync://", "http://")).searchParams.get("c")!;
    // The phone turns sync on after the first sweep went by, then scans a moment later.
    await new Promise((r) => setTimeout(r, 300));
    syncOn = true;
    await new Promise((r) => setTimeout(r, 600));
    expect((await lan.status()).paired).toBe(false);
    phone = fakePhone(await deriveLanKey(code));
    for (let i = 0; i < 40 && !(await lan.status()).paired; i++) await new Promise((r) => setTimeout(r, 100));
    expect((await lan.status()).address).toBe("192.168.1.77:47621");
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
});
