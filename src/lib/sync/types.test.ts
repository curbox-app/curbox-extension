import { describe, expect, it } from "vitest";
import { normalizeSyncStatus } from "./types";

describe("sync status normalization", () => {
  it("keeps an older unlocked response without devices from crashing the account screen", () => {
    expect(normalizeSyncStatus({
      signedIn: true,
      email: "person@example.com",
      hasVault: true,
      unlocked: true,
      deviceId: "browser-1",
      lastSync: 123,
      error: null,
      pendingEmail: null,
    })).toEqual({
      available: true,
      signedIn: true,
      email: "person@example.com",
      hasVault: true,
      unlocked: true,
      deviceId: "browser-1",
      lastSync: 123,
      error: null,
      pendingEmail: null,
      devices: [],
      preferences: {
        usageStats: true,
        reducerConfigs: true,
        usageDeviceIds: [],
      },
      billing: {
        required: false,
        entitled: true,
        provider: null,
        price: "$25/year",
        validUntil: null,
        cancelAtPeriodEnd: false,
      },
    });
  });

  it("filters malformed device and preference data at the message boundary", () => {
    const status = normalizeSyncStatus({
      unlocked: true,
      devices: [null, { platform: "android" }, {
        id: "phone-1",
        platform: "android",
        current: true,
      }],
      preferences: {
        usageStats: false,
        reducerConfigs: "yes",
        usageDeviceIds: ["phone-1", 7, "phone-1"],
      },
    });

    expect(status.devices).toEqual([{
      id: "phone-1",
      platform: "android",
      label: "android",
      lastSeen: null,
      current: true,
    }]);
    expect(status.preferences).toEqual({
      usageStats: false,
      reducerConfigs: true,
      usageDeviceIds: ["phone-1"],
    });
    expect(status.billing.entitled).toBe(true);
  });

  it("normalizes a premium entitlement from the worker", () => {
    const status = normalizeSyncStatus({
      signedIn: true,
      billing: {
        required: true,
        entitled: true,
        provider: "polar",
        price: "$25/year",
        validUntil: "2027-08-03T00:00:00Z",
        cancelAtPeriodEnd: true,
      },
    });

    expect(status.billing).toEqual({
      required: true,
      entitled: true,
      provider: "polar",
      price: "$25/year",
      validUntil: "2027-08-03T00:00:00Z",
      cancelAtPeriodEnd: true,
    });
  });
});
