/**
 * SSRF guard for routes that fetch a caller-supplied URL.
 *
 * `/api/fetch-url` lets a client hand us an arbitrary address, so the request
 * originates from inside the host's own network — which on the NAS means the
 * app itself, ~30 sibling containers, and the local Seek service. Resolve the
 * hostname first and refuse anything that lands on a non-public address, then
 * follow redirects by hand so every hop is checked (fetch's `redirect:
 * "follow"` would happily jump to an internal host).
 *
 * Residual risk: the address is validated at resolve time, not pinned, so a
 * DNS-rebinding attacker could still swap the record between our lookup and
 * the connection. Closing that needs connecting to the resolved IP directly.
 */
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_REDIRECTS = 3;
const USER_AGENT = "Mozilla/5.0 (compatible; HeliosGen/1.0)";

/** Loopback, private, link-local, CGNAT, multicast and reserved ranges. */
export function isBlockedAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const ip = address.toLowerCase();
    if (ip === "::" || ip === "::1") return true;
    if (ip.startsWith("fe80") || ip.startsWith("fc") || ip.startsWith("fd")) return true;
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isBlockedAddress(mapped[1]) : false;
  }
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return true;
  const [a, b] = parts;
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return a >= 224;
}

/** Throws unless the hostname is a literal public IP or resolves only to public ones. */
export async function assertPublicTarget(hostname: string): Promise<void> {
  const bare = hostname.replace(/^\[|\]$/g, "");
  if (isIP(bare)) {
    if (isBlockedAddress(bare)) throw new Error("URL resolves to a private address");
    return;
  }
  const records = await lookup(bare, { all: true }).catch(() => []);
  if (records.length === 0) throw new Error("Could not resolve host");
  if (records.some((r) => isBlockedAddress(r.address))) {
    throw new Error("URL resolves to a private address");
  }
}

/** Fetches `startUrl`, re-validating the target on every redirect hop. */
export async function fetchFollowingSafely(startUrl: string): Promise<Response> {
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const parsed = new URL(current);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      throw new Error("Only http/https URLs are supported");
    }
    await assertPublicTarget(parsed.hostname);
    const res = await fetch(current, { headers: { "User-Agent": USER_AGENT }, redirect: "manual" });
    const location = res.headers.get("location");
    if (res.status >= 300 && res.status < 400 && location) {
      current = new URL(location, current).toString();
      continue;
    }
    return res;
  }
  throw new Error("Too many redirects");
}
