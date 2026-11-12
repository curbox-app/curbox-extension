import { fromBase64Url, toBase64Url } from "../crypto";

// Short pairing codes. Must stay byte identical with CurboxSync's PairCode.kt.
//
// The phone shows six characters. They carry the last two parts of its WiFi address (so the
// browser knows exactly where to knock) and a 14 bit secret. The secret only proves the person
// typing can see the phone: the real key comes from an ECDH (P-256) exchange, so someone who
// merely listens on the WiFi learns nothing. The phone accepts codes only while Curbox Sync is
// open, and replaces the code after one use or five wrong tries.
//
//   value = third octet << 22 | fourth octet << 14 | secret   (30 bits, 6 Crockford base32 chars)
//   kCode = SHA-256("curbox-pair-v1|" + code)
//   proof = HMAC-SHA256(kCode, "b|" + phonePub + "|" + browserPub)   ("p|..." for the phone's)
//   key   = HKDF-SHA256(ikm = ECDH x, salt = kCode, info = "curbox-lan-v2|" + phonePub + "|" + browserPub)
// Public keys are SPKI DER in base64url.

export const SHORT_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
export const SHORT_LENGTH = 6;
const enc = new TextEncoder();

/** Uppercases and fixes look-alikes (O→0, I/L→1, U→V); drops spaces and dashes. */
export function normalizeShort(raw: string): string {
  return [...raw.toUpperCase()]
    .map((ch) => (ch === "O" ? "0" : ch === "I" || ch === "L" ? "1" : ch === "U" ? "V" : ch))
    .filter((ch) => SHORT_ALPHABET.includes(ch))
    .join("");
}

export function formatShort(code: string): string {
  const c = normalizeShort(code);
  return c.length === SHORT_LENGTH ? `${c.slice(0, 3)} ${c.slice(3)}` : c;
}

export function encodeShort(third: number, fourth: number, secret: number): string {
  let v = ((third & 0xff) << 22) | ((fourth & 0xff) << 14) | (secret & 0x3fff);
  let out = "";
  for (let i = 0; i < SHORT_LENGTH; i++) {
    out = SHORT_ALPHABET[v & 31] + out;
    v >>>= 5;
  }
  return out;
}

export function decodeShort(raw: string): { third: number; fourth: number; secret: number } | null {
  const code = normalizeShort(raw);
  if (code.length !== SHORT_LENGTH) return null;
  let v = 0;
  for (const ch of code) v = v * 32 + SHORT_ALPHABET.indexOf(ch);
  return { third: (v >>> 22) & 0xff, fourth: (v >>> 14) & 0xff, secret: v & 0x3fff };
}

/**
 * Where the phone may be: its last two address parts on each likely network. This computer's own
 * address and the phone's past ones come first; the common home ranges after.
 */
export function shortCandidates(raw: string, port: number, ...hints: (string | null | undefined)[]): string[] {
  const d = decodeShort(raw);
  if (!d) return [];
  const prefixes = hints
    .map((h) => h?.match(/^(\d{1,3}\.\d{1,3})\.\d{1,3}(\.\d{1,3})?(:\d+)?$/)?.[1])
    .filter((p): p is string => !!p && !p.startsWith("100.") && !p.startsWith("127."));
  const common = ["192.168", "10.0", "10.1", "10.10", "10.42", ...Array.from({ length: 16 }, (_, i) => `172.${16 + i}`)];
  return [...new Set([...prefixes, ...common])].map((p) => `${p}.${d.third}.${d.fourth}:${port}`);
}

async function sha256(data: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(data)));
}

export function codeKey(code: string): Promise<Uint8Array> {
  return sha256(`curbox-pair-v1|${normalizeShort(code)}`);
}

export async function pairProof(kCode: Uint8Array, side: "b" | "p", phonePub: string, browserPub: string): Promise<string> {
  const k = await crypto.subtle.importKey("raw", kCode as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const mac = await crypto.subtle.sign("HMAC", k, enc.encode(`${side}|${phonePub}|${browserPub}`));
  return toBase64Url(new Uint8Array(mac));
}

export async function sessionKey(shared: Uint8Array, kCode: Uint8Array, phonePub: string, browserPub: string): Promise<Uint8Array> {
  const ikm = await crypto.subtle.importKey("raw", shared as BufferSource, "HKDF", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "HKDF", hash: "SHA-256", salt: kCode as BufferSource, info: enc.encode(`curbox-lan-v2|${phonePub}|${browserPub}`) },
    ikm,
    256,
  );
  return new Uint8Array(bits);
}

/** A fresh ECDH key pair; returns its public half as SPKI base64url. */
export async function ecdhPair(): Promise<{ keys: CryptoKeyPair; pub: string }> {
  const keys = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"])) as CryptoKeyPair;
  return { keys, pub: toBase64Url(new Uint8Array(await crypto.subtle.exportKey("spki", keys.publicKey))) };
}

export async function ecdhShared(own: CryptoKey, otherPub: string): Promise<Uint8Array> {
  const other = await crypto.subtle.importKey("spki", fromBase64Url(otherPub) as BufferSource, { name: "ECDH", namedCurve: "P-256" }, false, []);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: other }, own, 256));
}

/** Constant time string compare for proofs. */
export function sameProof(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
