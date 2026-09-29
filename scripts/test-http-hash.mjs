import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import { sha256 } from "@noble/hashes/sha2.js";
import ts from "typescript";

function load(name, crypto, dependencies = {}) {
  const source = readFileSync(new URL(`../lib/${name}.ts`, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  runInNewContext(outputText, {
    exports, crypto, Uint8Array, ArrayBuffer, Blob, TextEncoder, atob,
    require: (id) => {
      assert.ok(id in dependencies, `unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
}

const vectors = [
  new Uint8Array(), new TextEncoder().encode("abc"),
  new TextEncoder().encode("a".repeat(1000000)),
  Uint8Array.from({ length: 65537 }, (_, i) => i % 256),
];

for (const [name, crypto] of [["native WebCrypto", webcrypto], ["LAN HTTP", {}], ["no crypto object", undefined]]) {
  test(`${name}: SHA-256 matches the server for empty, text, large, and binary input`, async () => {
    const { sha256Hex } = load("assetHash", crypto, { "@noble/hashes/sha2.js": { sha256 } });
    for (const bytes of vectors) {
      assert.equal(await sha256Hex(bytes.buffer), createHash("sha256").update(bytes).digest("hex"));
    }
  });
}

test("LAN HTTP workflow ZIP preserves media bytes and hash filenames", async () => {
  const hash = load("assetHash", {}, { "@noble/hashes/sha2.js": { sha256 } });
  const zip = load("makeZip", {});
  const { buildWorkflowZip } = load("exportWorkflow", {}, { "./assetHash": hash, "./makeZip": zip });
  const media = Buffer.from("HTTP LAN test media");
  const url = `data:image/png;base64,${media.toString("base64")}`;
  const { blob, result } = await buildWorkflowZip({
    name: "HTTP test", nodes: [{ id: "image-1", data: { inputImage: url } }],
    edges: [], nodeCounters: {}, createdAt: 0,
  });
  assert.equal(result.assetCount, 1);
  assert.equal(result.skipped, 0);
  const bytes = Buffer.from(await blob.arrayBuffer());
  const entries = new Map();
  let offset = 0;
  while (bytes.readUInt32LE(offset) === 0x04034b50) {
    const size = bytes.readUInt32LE(offset + 18);
    const nameLength = bytes.readUInt16LE(offset + 26);
    const extraLength = bytes.readUInt16LE(offset + 28);
    const name = bytes.toString("utf8", offset + 30, offset + 30 + nameLength);
    const start = offset + 30 + nameLength + extraLength;
    entries.set(name, bytes.subarray(start, start + size));
    offset = start + size;
  }
  const path = `assets/${createHash("sha256").update(media).digest("hex").slice(0, 16)}.png`;
  assert.deepEqual(entries.get(path), media);
  const manifest = JSON.parse(entries.get("workflow.json").toString("utf8"));
  assert.equal(manifest.workflow.nodes[0].data.inputImage, path);
});
