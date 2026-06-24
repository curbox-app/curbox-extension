// End to end encryption primitives for cross device sync.
//
// This file is the single source of truth for the wire format. The Android
// CryptoBox.kt mirrors every byte here so the two platforms interoperate.
//
// Envelope scheme:
//   KEK = PBKDF2-HMAC-SHA256(passphrase, salt, iterations) -> 32 bytes
//   DEK = 32 random bytes (the real data key)
//   wrapped_dek = blob( AES-256-GCM(KEK, DEK, aad = "<user_id>|vault") )
//
// Record blob layout (also used for wrapped_dek):
//   byte 0      : format version (0x01)
//   bytes 1..12 : 96 bit nonce
//   bytes 13..  : ciphertext || 128 bit tag
//
// AAD binds a record to its slot so ciphertext cannot be replayed elsewhere:
//   record aad = utf8("<user_id>|<namespace>|<record_key>")
//   vault  aad = utf8("<user_id>|vault")

export const FORMAT_VERSION = 0x01;
const NONCE_LEN = 12;
const TAG_BITS = 128;

export interface KdfParams {
  alg: "PBKDF2-HMAC-SHA256";
  iterations: number;
  hash: "SHA-256";
  dkLenBits: number;
}

export const DEFAULT_KDF_PARAMS: KdfParams = {
  alg: "PBKDF2-HMAC-SHA256",
  iterations: 600000,
  hash: "SHA-256",
  dkLenBits: 256,
};

const enc = new TextEncoder();
const dec = new TextDecoder();

export function randomBytes(len: number): Uint8Array {
  const out = new Uint8Array(len);
  crypto.getRandomValues(out);
  return out;
}

export function randomDEK(): Uint8Array {
  return randomBytes(32);
}

export function randomSalt(): Uint8Array {
  return randomBytes(16);
}

// Base64url without padding, matching Android's Base64.URL_SAFE | NO_PADDING.
export function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function fromBase64Url(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// Raw PBKDF2 bytes. Exposed so known answer tests can compare against Android.
export async function deriveKEKBytes(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<Uint8Array> {
  const base = await crypto.subtle.importKey("raw", enc.encode(passphrase), "PBKDF2", false, [
    "deriveBits",
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: params.iterations, hash: params.hash },
    base,
    params.dkLenBits,
  );
  return new Uint8Array(bits);
}

async function importAesKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw as BufferSource, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function deriveKEK(
  passphrase: string,
  salt: Uint8Array,
  params: KdfParams = DEFAULT_KDF_PARAMS,
): Promise<CryptoKey> {
  return importAesKey(await deriveKEKBytes(passphrase, salt, params));
}

function packBlob(nonce: Uint8Array, ctWithTag: Uint8Array): Uint8Array {
  const out = new Uint8Array(1 + nonce.length + ctWithTag.length);
  out[0] = FORMAT_VERSION;
  out.set(nonce, 1);
  out.set(ctWithTag, 1 + nonce.length);
  return out;
}

async function seal(
  key: CryptoKey,
  aad: string,
  plaintext: Uint8Array,
  nonce: Uint8Array = randomBytes(NONCE_LEN),
): Promise<Uint8Array> {
  const ct = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: enc.encode(aad), tagLength: TAG_BITS },
    key,
    plaintext as BufferSource,
  );
  return packBlob(nonce, new Uint8Array(ct));
}

async function open(key: CryptoKey, aad: string, blob: Uint8Array): Promise<Uint8Array> {
  if (blob[0] !== FORMAT_VERSION) throw new Error(`unsupported blob version ${blob[0]}`);
  const nonce = blob.subarray(1, 1 + NONCE_LEN);
  const ctWithTag = blob.subarray(1 + NONCE_LEN);
  const pt = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: nonce as BufferSource, additionalData: enc.encode(aad), tagLength: TAG_BITS },
    key,
    ctWithTag as BufferSource,
  );
  return new Uint8Array(pt);
}

function vaultAad(userId: string): string {
  return `${userId}|vault`;
}

export function recordAad(userId: string, namespace: string, recordKey: string): string {
  return `${userId}|${namespace}|${recordKey}`;
}

export async function wrapDEK(
  kek: CryptoKey,
  dek: Uint8Array,
  userId: string,
  nonce?: Uint8Array,
): Promise<Uint8Array> {
  return seal(kek, vaultAad(userId), dek, nonce);
}

export async function unwrapDEK(kek: CryptoKey, blob: Uint8Array, userId: string): Promise<Uint8Array> {
  return open(kek, vaultAad(userId), blob);
}

// A DEK ready to encrypt and decrypt sync records.
export async function importDEK(dek: Uint8Array): Promise<CryptoKey> {
  return importAesKey(dek);
}

export async function encryptRecord(
  dek: CryptoKey,
  aad: string,
  plaintext: string,
  nonce?: Uint8Array,
): Promise<Uint8Array> {
  return seal(dek, aad, enc.encode(plaintext), nonce);
}

export async function decryptRecord(dek: CryptoKey, aad: string, blob: Uint8Array): Promise<string> {
  return dec.decode(await open(dek, aad, blob));
}

// QR pairing payload. An unlocked device renders this; a new device scans or
// types it to receive the DEK without re entering the passphrase.
export interface PairingPayload {
  v: number;
  t: "curbox-dek";
  uid: string;
  dek: string; // base64url of 32 raw bytes
}

export function buildPairingPayload(userId: string, dek: Uint8Array): string {
  const payload: PairingPayload = { v: 1, t: "curbox-dek", uid: userId, dek: toBase64Url(dek) };
  return JSON.stringify(payload);
}

export function parsePairingPayload(raw: string): { userId: string; dek: Uint8Array } {
  const payload = JSON.parse(raw) as PairingPayload;
  if (payload.t !== "curbox-dek" || payload.v !== 1) throw new Error("not a curbox pairing code");
  const dek = fromBase64Url(payload.dek);
  if (dek.length !== 32) throw new Error("bad pairing key length");
  return { userId: payload.uid, dek };
}
