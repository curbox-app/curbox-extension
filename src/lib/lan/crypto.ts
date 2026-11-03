import { fromBase64Url, randomBytes, toBase64Url } from "../crypto";

// Must stay byte identical with CurboxSync's LanCrypto.kt.
export const CODE_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
export const CODE_LENGTH = 12;
export const REQUEST_AAD = "curbox-lan-v1|req";
export const responseAad = (id: string) => `curbox-lan-v1|res|${id}`;

const SALT = "curbox-lan-v1";
const ITERATIONS = 100_000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export function normalizeCode(code: string): string {
  return [...code.toUpperCase()].filter((ch) => CODE_ALPHABET.includes(ch)).join("");
}

export async function deriveLanKey(code: string): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", enc.encode(normalizeCode(code)), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt: enc.encode(SALT), iterations: ITERATIONS },
    base,
    256,
  );
  return new Uint8Array(bits);
}

function importKey(key: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", key as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function seal(key: Uint8Array, aad: string, plaintext: string, nonce = randomBytes(12)): Promise<string> {
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: enc.encode(aad), tagLength: 128 },
      await importKey(key),
      enc.encode(plaintext),
    ),
  );
  const out = new Uint8Array(nonce.length + ct.length);
  out.set(nonce);
  out.set(ct, nonce.length);
  return toBase64Url(out);
}

export async function open(key: Uint8Array, aad: string, blob: string): Promise<string> {
  const raw = fromBase64Url(blob.trim());
  if (raw.length <= 28) throw new Error("blob too short");
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: raw.slice(0, 12), additionalData: enc.encode(aad), tagLength: 128 },
    await importKey(key),
    raw.slice(12),
  );
  return dec.decode(pt);
}
