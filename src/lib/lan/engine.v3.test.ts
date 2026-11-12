import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "#imports";
import { get, set } from "../storage";
import { newFocusGroup } from "../types";
import { deriveLanKey, open, REQUEST_AAD, responseAad, seal } from "./crypto";
import { LanSync } from "./engine";
import type { PhoneGroup, PhoneState } from "./reconcile";

const CODE = "ABCDEFGHJKMN";

// CurboxSync proto 3 on Curbox API 7: Pomodoro cycles and full group lists.
function richPhone(key: Uint8Array) {
  const groups: PhoneGroup[] = [{ id: "p1", name: "Study", exitable: true, blockMode: "BLOCK_SELECTED", apps: 3, websites: ["news.com"] }];
  const phone: PhoneState = {
    connected: true, apiVersion: 7, active: false, groupId: "", name: "", endsAt: 0, exitable: true, exact: true,
    changedAt: Date.now(), rev: 1, groups: [], caps: ["pomodoro", "groups"], groupsHash: "h1",
  };
  const calls: Record<string, unknown>[] = [];
  const bump = () => {
    phone.rev++;
    phone.changedAt = Date.now();
  };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const req = JSON.parse(await open(key, REQUEST_AAD, String(init.body)));
    calls.push(req);
    const reply: Record<string, unknown> = { ok: true, now: Date.now() };
    if (req.op === "wait") await new Promise(() => undefined);
    if (req.op === "focus") {
      const f = req.focus;
      Object.assign(phone, f.active
        ? { active: true, groupId: f.groupId, name: f.name, endsAt: f.endsAt, phase: f.phase, pomodoro: f.pomodoro }
        : { active: false, groupId: "", name: "", endsAt: 0, phase: "", pomodoro: undefined });
      bump();
      reply.result = "applied";
    }
    if (req.op === "saveGroups") {
      const results: Record<string, string> = {};
      for (const e of req.save) {
        const g = groups.find((x) => x.id === e.id);
        const next = { id: e.id, name: e.name, exitable: e.exitable, blockMode: e.blockMode, apps: g?.apps ?? 0, websites: e.websites };
        if (g) Object.assign(g, next);
        else groups.push(next);
        results[e.id] = "applied";
      }
      for (const id of req.delete) {
        groups.splice(groups.findIndex((g) => g.id === id), 1);
        results[id] = "applied";
      }
      phone.groupsHash = `h${phone.rev}`;
      bump();
      reply.results = results;
    }
    if (req.op === "groups" || req.op === "saveGroups") reply.groups = groups.map((g) => ({ ...g }));
    phone.groups = groups.map(({ websites: _w, ...g }) => g);
    reply.phone = { ...phone };
    return new Response(await seal(key, responseAad(req.id), JSON.stringify(reply)), { status: 200 });
  });
  return { phone, groups, calls, fetchMock, bump };
}

describe("lan engine with pomodoro and groups", () => {
  let fake: ReturnType<typeof richPhone>;

  beforeEach(async () => {
    browser.storage.local.clear();
    fake = richPhone(await deriveLanKey(CODE));
    vi.stubGlobal("fetch", fake.fetchMock);
    const settings = await get("settings");
    await set("settings", { ...settings, focusGroups: [{ ...newFocusGroup("Study"), id: "e1", domains: ["video.com"] }, { ...newFocusGroup("Read"), id: "e2", domains: ["r.com"] }] });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("shares website lists both ways on pairing", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    const local = (await get("settings")).focusGroups;
    expect(local.find((g) => g.id === "e1")?.domains).toEqual(["news.com", "video.com"]);
    expect(fake.groups.find((g) => g.id === "p1")?.websites).toEqual(["news.com", "video.com"]);
    expect(fake.groups.find((g) => g.id === "e2")).toMatchObject({ name: "Read", websites: ["r.com"] });
  });

  it("sends a later browser edit and a phone edit", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    const settings = await get("settings");
    await set("settings", { ...settings, focusGroups: settings.focusGroups.map((g) => (g.id === "e2" ? { ...g, domains: ["r.com", "s.com"] } : g)) });
    await lan.onLocalSettingsChanged((await get("settings")).focusGroups);
    expect(fake.groups.find((g) => g.id === "e2")?.websites).toEqual(["r.com", "s.com"]);

    fake.groups.find((g) => g.id === "p1")!.websites = ["video.com"];
    fake.phone.groupsHash = "edited";
    fake.bump();
    await lan.syncNow();
    expect((await get("settings")).focusGroups.find((g) => g.id === "e1")?.domains).toEqual(["video.com"]);
  });

  it("joins a phone pomodoro at its break", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    Object.assign(fake.phone, {
      active: true, groupId: "p1", name: "Study", endsAt: Date.now() + 4 * 60_000, phase: "break",
      pomodoro: { phase: "BREAK", focusMinutes: 25, breakMinutes: 5, rounds: 4, completed: 1 },
    });
    fake.bump();
    await lan.syncNow();
    const focus = await get("focus");
    expect(focus?.pomodoro).toEqual({ phase: "break", focusMinutes: 25, breakMinutes: 5, totalRounds: 4, completedRounds: 1 });
    expect(focus?.groupId).toBe("e1");
  });

  it("sends a browser pomodoro with its cycle", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    const { startSession } = await import("../../core/focus");
    const group = (await get("settings")).focusGroups.find((g) => g.id === "e1")!;
    await startSession(group, 25, true, { breakMinutes: 5, rounds: 4 });
    await lan.onLocalFocusChanged();
    const sent = fake.calls.find((c) => c.op === "focus") as { focus: Record<string, unknown> };
    expect(sent.focus).toMatchObject({ active: true, phase: "focus", pomodoro: { phase: "focus", rounds: 4, completed: 0, focusMinutes: 25 } });
  });
});
