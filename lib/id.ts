/**
 * ID generation.
 *
 * `crypto.randomUUID()` is gated behind a **secure context**. A static export
 * downloaded and opened straight off disk (`file://…/out/index.html`) is
 * exactly what a user of an offline-first tool does, and in that context the
 * method is either absent or throws. There is no server to fall back on, so a
 * real fallback ships here.
 *
 * `crypto.getRandomValues()` is NOT secure-context-gated, so the fallback is
 * still cryptographically random almost everywhere; `Math.random()` is the
 * final backstop for exotic runtimes. IDs are document-local (they never leave
 * the user's machine and are never a security boundary), so that is acceptable.
 */

/** Generates an RFC 4122 v4 UUID string. Never throws. */
export function newId(): string {
  const c: Crypto | undefined = globalThis.crypto;

  if (c && typeof c.randomUUID === "function") {
    try {
      return c.randomUUID();
    } catch {
      // Insecure context (file://, plain http on some engines) — fall through.
    }
  }

  return uuidV4FromBytes(randomBytes(16));
}

function randomBytes(n: number): Uint8Array {
  const bytes = new Uint8Array(n);
  const c: Crypto | undefined = globalThis.crypto;

  if (c && typeof c.getRandomValues === "function") {
    c.getRandomValues(bytes);
    return bytes;
  }

  for (let i = 0; i < n; i++) {
    bytes[i] = Math.floor(Math.random() * 256);
  }
  return bytes;
}

function uuidV4FromBytes(bytes: Uint8Array): string {
  // Version 4 + RFC 4122 variant bits.
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  let hex = "";
  for (let i = 0; i < 16; i++) {
    hex += bytes[i]!.toString(16).padStart(2, "0");
  }

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}
