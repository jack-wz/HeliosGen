import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/**
 * Loads lib/ssrfGuard.ts with a stubbed DNS resolver, so the address policy can
 * be exercised without real lookups. `node:net` is the real module — isIP is
 * pure and we want its actual behaviour, not a stand-in.
 */
function load(dnsRecords = {}) {
  const source = readFileSync(new URL("../lib/ssrfGuard.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  const dependencies = {
    "node:net": { isIP },
    "node:dns/promises": {
      lookup: async (host) => {
        const records = dnsRecords[host];
        if (!records) throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
        return records.map((address) => ({ address, family: isIP(address) }));
      },
    },
  };
  runInNewContext(outputText, {
    exports,
    URL,
    fetch: globalThis.fetch,
    require: (id) => {
      assert.ok(id in dependencies, `unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
}

const BLOCKED = [
  "127.0.0.1", "127.1.2.3", "0.0.0.0", "10.0.0.1", "10.255.255.255",
  "172.16.0.1", "172.31.255.255", "192.168.1.185", "169.254.169.254",
  "100.64.0.1", "100.127.255.255", "224.0.0.1", "255.255.255.255",
  "::1", "::", "fe80::1", "fc00::1", "fd12:3456::1", "::ffff:127.0.0.1",
  // fails closed on malformed input rather than letting it through
  "999.1.1.1", "1.2.3", "not-an-ip",
];

const ALLOWED = [
  "8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111",
  "172.15.255.255", "172.32.0.1", "100.63.255.255", "100.128.0.0",
];

test("blocks loopback, private, link-local, CGNAT and multicast addresses", () => {
  const { isBlockedAddress } = load();
  for (const address of BLOCKED) {
    assert.equal(isBlockedAddress(address), true, `${address} should be blocked`);
  }
});

test("allows public addresses, including the ranges just outside the private blocks", () => {
  const { isBlockedAddress } = load();
  for (const address of ALLOWED) {
    assert.equal(isBlockedAddress(address), false, `${address} should be allowed`);
  }
});

test("assertPublicTarget rejects a literal private address", async () => {
  const { assertPublicTarget } = load();
  await assert.rejects(() => assertPublicTarget("127.0.0.1"), /private address/);
  await assert.rejects(() => assertPublicTarget("169.254.169.254"), /private address/);
  await assert.rejects(() => assertPublicTarget("[::1]"), /private address/);
});

test("assertPublicTarget rejects a hostname that resolves inward", async () => {
  const { assertPublicTarget } = load({ "localhost": ["127.0.0.1"] });
  await assert.rejects(() => assertPublicTarget("localhost"), /private address/);

  // One private record among public ones is enough to refuse — a multi-record
  // hostname must not be usable as a coin flip.
  const mixed = load({ "mixed.test": ["93.184.216.34", "10.0.0.5"] });
  await assert.rejects(() => mixed.assertPublicTarget("mixed.test"), /private address/);
});

test("assertPublicTarget accepts a genuinely public hostname", async () => {
  const { assertPublicTarget } = load({ "example.com": ["93.184.216.34"] });
  await assertPublicTarget("example.com");
});

test("assertPublicTarget refuses an unresolvable host", async () => {
  const { assertPublicTarget } = load();
  await assert.rejects(() => assertPublicTarget("nope.invalid"), /Could not resolve host/);
});
