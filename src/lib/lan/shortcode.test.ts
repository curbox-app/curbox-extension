import { describe, expect, it } from "vitest";
import { toBase64Url } from "../crypto";
import { codeKey, decodeShort, ecdhPair, ecdhShared, encodeShort, formatShort, normalizeShort, pairProof, sessionKey, shortCandidates } from "./shortcode";

// Shared with CurboxSync's PairCodeTest.kt; change both together.
const VECTOR = {
  code: encodeShort(29, 197, 12345),
  phonePub: "phonePUB",
  browserPub: "browserPUB",
  shared: new Uint8Array(32).map((_, i) => i),
};

describe("short pairing codes", () => {
  it("round trips the address and secret", () => {
    expect(VECTOR.code).toBe("3Q2W1S");
    expect(decodeShort(VECTOR.code)).toEqual({ third: 29, fourth: 197, secret: 12345 });
    expect(decodeShort(encodeShort(255, 255, 0x3fff))).toEqual({ third: 255, fourth: 255, secret: 0x3fff });
    expect(decodeShort("1VJ")).toBeNull();
  });

  it("forgives how people type", () => {
    expect(normalizeShort(" 1vj-61s ")).toBe("1VJ61S");
    expect(normalizeShort("oIlu")).toBe("011V");
    expect(formatShort("1vj61s")).toBe("1VJ 61S");
  });

  it("knocks on this network first", () => {
    const c = shortCandidates(VECTOR.code, 47621, "10.5.0.3", "192.168.29.197:47621", "100.72.1.1:47621");
    expect(c[0]).toBe("10.5.29.197:47621");
    expect(c[1]).toBe("192.168.29.197:47621");
    expect(c.some((a) => a.startsWith("100."))).toBe(false);
    expect(new Set(c).size).toBe(c.length);
  });

  it("matches the phone's crypto", async () => {
    const k = await codeKey(VECTOR.code);
    expect(toBase64Url(k)).toBe("For3oO9sKAS46pMH8RMqaKreThcuDrKRYIXSOUQJQM4");
    expect(await pairProof(k, "b", VECTOR.phonePub, VECTOR.browserPub)).toBe("pAqx2xJdEB8ycAJdSHnS5CUgIyRj-e1US0w9q0NWhtg");
    expect(await pairProof(k, "p", VECTOR.phonePub, VECTOR.browserPub)).toBe("xjneHoCfoAxMf0-2JkfxTrON4bWQ34sd5VzsfejYJ3A");
    expect(toBase64Url(await sessionKey(VECTOR.shared, k, VECTOR.phonePub, VECTOR.browserPub))).toBe("quf9YQAdHSYjsdSQnQQRdEpAPiJMVK6zFV1tc2VnGjY");
  });

  it("agrees on one key from both sides", async () => {
    const a = await ecdhPair();
    const b = await ecdhPair();
    expect(await ecdhShared(a.keys.privateKey, b.pub)).toEqual(await ecdhShared(b.keys.privateKey, a.pub));
  });
});
