import { describe, expect, it } from "vitest";
import { CODE_ALPHABET } from "./crypto";
import { candidateSubnets, newPairingCode, pairingLink } from "./link";

describe("pairing link", () => {
  it("carries a fresh code", () => {
    const code = newPairingCode();
    expect(code).toHaveLength(12);
    expect([...code].every((c) => CODE_ALPHABET.includes(c))).toBe(true);
    expect(pairingLink(code)).toBe(`curboxsync://pair?c=${code}`);
  });

  it("tries hinted subnets first", () => {
    const subnets = candidateSubnets("192.168.31.70:47621", "10.9.8", null);
    expect(subnets.slice(0, 2)).toEqual(["192.168.31", "10.9.8"]);
    expect(subnets.filter((s) => s === "192.168.31")).toHaveLength(1);
  });
});
