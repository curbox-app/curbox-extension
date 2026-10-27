import { beforeEach, describe, expect, it } from "vitest";
import { fakeBrowser } from "@webext-core/fake-browser";
import { enableStorageCache, get, getUsage, migrateSettings, set, update, updateUsageDays } from "./storage";

describe("storage", () => {
  beforeEach(() => {
    fakeBrowser.reset();
    enableStorageCache();
  });

  it("never drops a concurrent update", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => update("grants", (grants) => ({ ...grants, [`g${i}`]: i }))),
    );
    expect(Object.keys(await get("grants"))).toHaveLength(20);
  });

  it("skips the write when an update changes nothing", async () => {
    await set("grants", { a: 1 });
    let writes = 0;
    fakeBrowser.storage.local.onChanged.addListener(() => writes++);
    await update("grants", (grants) => grants);
    expect(writes).toBe(0);
  });

  it("sees writes made by another context", async () => {
    await set("grants", { a: 1 });
    expect(await get("grants")).toEqual({ a: 1 });
    await fakeBrowser.storage.local.set({ grants: { b: 2 } });
    expect(await get("grants")).toEqual({ b: 2 });
  });

  it("reads usage day by day", async () => {
    await updateUsageDays(["2026-06-15", "2026-06-16"], (day) => ({ [day]: { ms: 1, paths: { "": 1 } } }));
    const usage = await getUsage(["2026-06-15", "2026-06-16", "2026-06-17"]);
    expect(Object.keys(usage)).toEqual(["2026-06-15", "2026-06-16"]);
    expect(usage["2026-06-16"]["2026-06-16"].ms).toBe(1);
  });

  it("stores upgraded settings once so generated ids stay stable", async () => {
    await fakeBrowser.storage.local.set({ settings: { groups: [{ name: "Social" }] } });
    await migrateSettings();
    const first = (await get("settings")).groups[0].id;
    expect(first).toBeTruthy();
    expect((await get("settings")).groups[0].id).toBe(first);
  });
});
