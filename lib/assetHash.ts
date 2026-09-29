import { sha256 } from "@noble/hashes/sha2.js";

/** Compute the same SHA-256 digest on HTTPS, localhost, and plain HTTP LAN origins. */
export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  // SubtleCrypto requires a secure context; hashing media is also needed on LAN HTTP.
  const subtle = globalThis.crypto?.subtle;
  const digest = subtle
    ? new Uint8Array(await subtle.digest("SHA-256", buffer))
    : sha256(new Uint8Array(buffer));
  return Array.from(digest)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
