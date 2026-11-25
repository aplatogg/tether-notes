const ITERATIONS = 150_000;
const KEY_LENGTH = 32;
const ENCRYPTED_PREFIX = "enc:v1:";

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function importPinKey(pin: string, usages: KeyUsage[]): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    usages,
  );
}

async function derive(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await importPinKey(pin, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
}

async function deriveAesKey(
  pin: string,
  salt: Uint8Array,
  usages: ("encrypt" | "decrypt")[],
): Promise<CryptoKey> {
  // Domain-separated salt for encryption so the AES key is cryptographically
  // independent from the verification hash stored in lock_hash.
  const encSalt = new Uint8Array(salt.length + 4);
  encSalt.set(salt, 0);
  encSalt.set([0x65, 0x6e, 0x63, 0x31], salt.length); // "enc1"

  const baseKey = await importPinKey(pin, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encSalt as unknown as BufferSource,
      iterations: ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    usages,
  );
}

/** Creates the `salt:hash` string stored with a locked note. */
export async function createLockSecret(pin: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt);
  return `${toBase64(salt)}:${toBase64(hash)}`;
}

export async function verifyLockPin(pin: string, secret: string): Promise<boolean> {
  const [saltPart, hashPart] = secret.split(":");
  if (!saltPart || !hashPart) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(saltPart);
    expected = fromBase64(hashPart);
  } catch {
    return false;
  }

  const hash = await derive(pin, salt);

  // Constant-time comparison over equal-length byte arrays.
  if (expected.length !== hash.length) return false;

  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= expected[index] ^ hash[index];
  }

  return difference === 0;
}

export function isLockSecret(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[^:]+:[^:]+$/.test(value);
}

/** True when a note body carries an AES-256-GCM encrypted payload. */
export function isEncryptedBody(body: string | null | undefined): boolean {
  return typeof body === "string" && body.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Encrypts a plaintext note body with AES-256-GCM using a key derived from the
 * user's PIN and the salt inside `lockSecret`. Returns `enc:v1:<iv>:<ciphertext>`.
 */
export async function encryptLockedBody(
  plaintext: string,
  pin: string,
  lockSecret: string,
): Promise<string> {
  const [saltPart] = lockSecret.split(":");
  if (!saltPart) throw new Error("Invalid lock secret");
  const salt = fromBase64(saltPart);
  const key = await deriveAesKey(pin, salt, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: iv as unknown as BufferSource },
    key,
    encoded as unknown as BufferSource,
  );
  return `${ENCRYPTED_PREFIX}${toBase64(iv)}:${toBase64(new Uint8Array(cipherBuffer))}`;
}

/**
 * Decrypts an `enc:v1:<iv>:<ciphertext>` note body with the user's PIN and
 * `lockSecret`. Legacy unencrypted bodies are returned as-is for backward
 * compatibility. Returns `null` if the PIN or ciphertext is invalid.
 */
export async function decryptLockedBody(
  body: string,
  pin: string,
  lockSecret: string,
): Promise<string | null> {
  if (!isEncryptedBody(body)) {
    const ok = await verifyLockPin(pin, lockSecret);
    return ok ? body : null;
  }

  const [saltPart] = lockSecret.split(":");
  if (!saltPart) return null;

  const payload = body.slice(ENCRYPTED_PREFIX.length);
  const [ivPart, cipherPart] = payload.split(":");
  if (!ivPart || !cipherPart) return null;

  try {
    const salt = fromBase64(saltPart);
    const iv = fromBase64(ivPart);
    const ciphertext = fromBase64(cipherPart);
    const key = await deriveAesKey(pin, salt, ["decrypt"]);
    const plainBuffer = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: iv as unknown as BufferSource },
      key,
      ciphertext as unknown as BufferSource,
    );
    return new TextDecoder().decode(plainBuffer);
  } catch {
    return null;
  }
}
