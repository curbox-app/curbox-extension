import { describe, expect, it } from "vitest";
import { fromBase64Url, toBase64Url } from "../crypto";
import { deriveLanKey, normalizeCode, open, REQUEST_AAD, responseAad, seal } from "./crypto";

// The same vector is asserted by CurboxSync's LanCryptoTest.kt.
const CODE = "abcd efgh jkmn";
const KEY = "tE9kkV_GRNDzPb-01O88D1KAlYvYBCe17xPpLFql3IM";
const BLOB = "AAECAwQFBgcICQoLEznSUdb8T3fZS0qz5HeeGjGzJN-kzwbm3sL0Mtro";

describe("lan crypto", () => {
  it("normalizes codes", () => {
    expect(normalizeCode(CODE)).toBe("ABCDEFGHJKMN");
  });

  it("derives the shared key", async () => {
    expect(toBase64Url(await deriveLanKey(CODE))).toBe(KEY);
  });

  it("seals the shared vector", async () => {
    const nonce = Uint8Array.from({ length: 12 }, (_, i) => i);
    expect(await seal(fromBase64Url(KEY), REQUEST_AAD, '{"op":"state"}', nonce)).toBe(BLOB);
    expect(await open(fromBase64Url(KEY), REQUEST_AAD, BLOB)).toBe('{"op":"state"}');
  });

  it("rejects the wrong aad", async () => {
    await expect(open(fromBase64Url(KEY), responseAad("x"), BLOB)).rejects.toThrow();
  });
});
