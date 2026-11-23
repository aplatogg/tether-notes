const ITERATIONS = 150_000;
const KEY_LENGTH = 32;

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((byte) => {
    binary += String.fromCharCode(byte);
  });
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function derive(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(pin),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt as unknown as BufferSource, iterations: ITERATIONS, hash: "SHA-256" },
    key,
    KEY_LENGTH * 8,
  );
  return new Uint8Array(bits);
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

  const hash = await derive(pin, fromBase64(saltPart));

  // Constant-time comparison over equal-length byte arrays.
  const expected = fromBase64(hashPart);
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
