import assert from "node:assert/strict";
import { randomFillSync } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL("../lib/browserId.ts", import.meta.url), "utf8");
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2017 },
});
const uuidV4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function loadWithCrypto(crypto) {
  const exports = {};
  runInNewContext(outputText, { exports, crypto });
  return exports.createBrowserId;
}

test("uses native randomUUID with its crypto receiver when available", () => {
  const id = "461a8732-c3eb-451f-a89f-06610fc2661a";
  const crypto = {
    randomUUID() {
      assert.equal(this, crypto);
      return id;
    },
    getRandomValues() {
      assert.fail("fallback must not run when native randomUUID is available");
    },
  };
  assert.equal(loadWithCrypto(crypto)(), id);
});

test("LAN HTTP fallback sets RFC 4122 version and variant bits", () => {
  for (const fill of [0x00, 0xff]) {
    const crypto = {
      getRandomValues(bytes) {
        assert.equal(this, crypto);
        assert.equal(bytes.length, 16);
        return bytes.fill(fill);
      },
    };
    const id = loadWithCrypto(crypto)();
    assert.match(id, uuidV4);
    assert.equal(id, fill === 0
      ? "00000000-0000-4000-8000-000000000000"
      : "ffffffff-ffff-4fff-bfff-ffffffffffff");
  }
});

test("falls back when randomUUID is present but not callable", () => {
  const createId = loadWithCrypto({
    randomUUID: null,
    getRandomValues: (bytes) => randomFillSync(bytes),
  });
  assert.match(createId(), uuidV4);
});

test("fallback produces distinct v4 IDs using secure random values", () => {
  const createId = loadWithCrypto({ getRandomValues: (bytes) => randomFillSync(bytes) });
  const ids = new Set();
  for (let index = 0; index < 10000; index += 1) {
    const id = createId();
    assert.match(id, uuidV4);
    ids.add(id);
  }
  assert.equal(ids.size, 10000);
});

test("fails clearly when secure randomness is unavailable", () => {
  for (const crypto of [undefined, {}, { getRandomValues: null }]) {
    assert.throws(loadWithCrypto(crypto), /secure random values are unavailable/);
  }
});
