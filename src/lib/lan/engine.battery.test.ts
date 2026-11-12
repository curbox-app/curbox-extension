import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { browser } from "#imports";
import { open, REQUEST_AAD, responseAad, seal, deriveLanKey } from "./crypto";
import { LanSync } from "./engine";
import type { PhoneState } from "./reconcile";

const CODE = "ABCDEFGHJKMN";

// A proto 4 phone whose screen can be switched; `wait` never answers.
function phone(key: Uint8Array) {
  const state: PhoneState = {
    connected: true, apiVersion: 4, active: false, groupId: "", name: "", endsAt: 0, exitable: true,
    exact: true, changedAt: Date.now(), rev: 1, groups: [],
  };
  const ops: string[] = [];
  const screen = { on: false };
  const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
    const req = JSON.parse(await open(key, REQUEST_AAD, String(init.body)));
    ops.push(req.op);
    if (req.op === "wait") await new Promise(() => undefined);
    const reply = { ok: true, now: Date.now(), awake: screen.on, push: true, phone: { ...state }, known: {} };
    return new Response(await seal(key, responseAad(req.id), JSON.stringify(reply)), { status: 200 });
  });
  return { ops, screen, fetchMock };
}

describe("lan engine battery pacing", () => {
  let fake: ReturnType<typeof phone>;
  let now = 1_700_000_000_000;

  beforeEach(async () => {
    browser.storage.local.clear();
    fake = phone(await deriveLanKey(CODE));
    vi.stubGlobal("fetch", fake.fetchMock);
    now = 1_700_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const states = () => fake.ops.filter((op) => op === "state").length;

  it("leaves a phone with its screen off alone between quiet rounds", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    const after = states();
    for (let i = 0; i < 9; i++) {
      now += 30_000;
      await lan.onTick();
    }
    expect(states()).toBe(after);
    expect(fake.ops).not.toContain("wait");
    now += 30_000;
    await lan.onTick();
    expect(states()).toBe(after + 1);
  });

  it("asks nothing while this computer is idle, and catches up on return", async () => {
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    await lan.onMachineState("idle");
    const after = states();
    for (let i = 0; i < 40; i++) {
      now += 30_000;
      await lan.onTick();
    }
    expect(states()).toBe(after);
    await lan.onMachineState("active");
    expect(states()).toBe(after + 1);
  });

  it("long polls only while the phone's screen is on", async () => {
    fake.screen.on = true;
    const lan = new LanSync();
    await lan.pair("192.168.1.20", CODE);
    await vi.waitFor(() => expect(fake.ops).toContain("wait"));
  });
});
