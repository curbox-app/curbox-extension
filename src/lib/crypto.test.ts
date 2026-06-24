import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  decryptRecord,
  deriveKEK,
  deriveKEKBytes,
  encryptRecord,
  fromBase64Url,
  importDEK,
  recordAad,
  toHex,
  unwrapDEK,
  wrapDEK,
  type KdfParams,
} from "./crypto";

// Fixed inputs shared byte for byte with Android's CryptoBoxTest. Iterations
// are kept low here only so the parity vectors are cheap to compute; production
// uses DEFAULT_KDF_PARAMS (600k).
const VECTORS = {
  passphrase: "correct horse battery staple",
  saltHex: "000102030405060708090a0b0c0d0e0f",
  params: { alg: "PBKDF2-HMAC-SHA256", iterations: 10000, hash: "SHA-256", dkLenBits: 256 } as KdfParams,
  dekHex: "202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f",
  wrapNonceHex: "aabbccddeeff001122334455",
  recordNonceHex: "0f0e0d0c0b0a090807060504",
  userId: "11111111-2222-3333-4444-555555555555",
  namespace: "ext_config",
  recordKey: "config",
  plaintext: '{"groups":[],"focusGroups":[]}',
};

function hexToBytes(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

describe("crypto parity vectors", () => {
  it("derives the KEK, wraps the DEK, and seals a record deterministically", async () => {
    const salt = hexToBytes(VECTORS.saltHex);
    const dek = hexToBytes(VECTORS.dekHex);

    const kekBytes = await deriveKEKBytes(VECTORS.passphrase, salt, VECTORS.params);
    const kek = await deriveKEK(VECTORS.passphrase, salt, VECTORS.params);

    const wrapped = await wrapDEK(kek, dek, VECTORS.userId, hexToBytes(VECTORS.wrapNonceHex));

    const dekKey = await importDEK(dek);
    const aad = recordAad(VECTORS.userId, VECTORS.namespace, VECTORS.recordKey);
    const record = await encryptRecord(dekKey, aad, VECTORS.plaintext, hexToBytes(VECTORS.recordNonceHex));

    const expected = {
      kekHex: toHex(kekBytes),
      wrappedDekHex: toHex(wrapped),
      recordHex: toHex(record),
    };

    // Round trips must succeed.
    expect(toHex(await unwrapDEK(kek, wrapped, VECTORS.userId))).toBe(VECTORS.dekHex);
    expect(await decryptRecord(dekKey, aad, record)).toBe(VECTORS.plaintext);

    // Emit the canonical vectors so the Android test asserts the same bytes.
    const out = { ...VECTORS, expected };
    writeFileSync(
      fileURLToPath(new URL("./crypto.vectors.json", import.meta.url)),
      JSON.stringify(out, null, 2) + "\n",
    );

    expect(expected.kekHex).toHaveLength(64);
    expect(fromBase64Url("AQID")).toEqual(new Uint8Array([1, 2, 3]));
  });
});
