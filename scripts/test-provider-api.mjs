import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runInNewContext } from "node:vm";
import ts from "typescript";

/**
 * Loads lib/providerRegistry.ts with a stubbed @/lib/guest/db, so the
 * "is this provider configured" logic can be exercised without SQLite.
 */
function load(settings = {}, env = {}) {
  const source = readFileSync(new URL("../lib/providerRegistry.ts", import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  const dependencies = {
    "@/lib/guest/db": {
      getKieApiToken: () => env.kie ?? null,
      getAzureApiKey: () => env.azure ?? null,
      getSetting: (key) => settings[key] ?? null,
    },
  };
  runInNewContext(outputText, {
    exports,
    require: (id) => {
      assert.ok(id in dependencies, `unexpected dependency: ${id}`);
      return dependencies[id];
    },
  });
  return exports;
}

test("listProviders never exposes the internal secret reference", () => {
  const { listProviders } = load();
  const providers = listProviders();
  assert.equal(providers.length, 8);

  const serialized = JSON.stringify(providers);
  assert.ok(!serialized.includes("secretRef"), `secretRef leaked: ${serialized}`);
  // The reference names are the thing that used to leak — check those too.
  for (const name of ["kie_api_token", "fal_api_key", "azure_api_key", "openai_api_key"]) {
    assert.ok(!serialized.includes(name), `${name} leaked`);
  }
  // auth survives, minus the reference.
  for (const p of providers) assert.ok(typeof p.auth.mode === "string");
});

test("getProviderDefinition keeps secretRef for internal route use", () => {
  const { getProviderDefinition } = load();
  assert.equal(getProviderDefinition("kie").auth.secretRef, "kie_api_token");
  assert.equal(getProviderDefinition("nope"), null);
});

test("configured honours a stored key for providers other than kie/azure", () => {
  const { listProviders } = load({ fal_api_key: "stored" });
  const byId = Object.fromEntries(listProviders().map((p) => [p.id, p.configured]));
  assert.equal(byId.fal, true, "fal key was stored but reported unconfigured");
  assert.equal(byId.replicate, false);
  assert.equal(byId.openai, false);
});

test("configured honours the env fallback for kie and azure", () => {
  const { listProviders } = load({}, { kie: "env-key" });
  const byId = Object.fromEntries(listProviders().map((p) => [p.id, p.configured]));
  assert.equal(byId.kie, true);
  assert.equal(byId.azure, false);

  const azure = Object.fromEntries(load({}, { azure: "env-key" }).listProviders().map((p) => [p.id, p.configured]));
  assert.equal(azure.azure, true);
});

test("getProvider and listProviders agree on configured for every provider", () => {
  // Regression: the per-provider route used to compute `configured` from the
  // raw setting, ignoring the env fallback, so the same provider answered
  // differently from the two endpoints (and contradicted itself in one body).
  for (const [settings, env] of [
    [{}, {}],
    [{ fal_api_key: "x" }, {}],
    [{}, { kie: "x" }],
    [{ kie_api_token: "db" }, { kie: "env" }],
  ]) {
    const { listProviders, getProvider } = load(settings, env);
    for (const p of listProviders()) {
      assert.equal(getProvider(p.id).configured, p.configured, `disagreement on ${p.id}`);
    }
  }
});

test("providers without an api key never report configured", () => {
  const { listProviders } = load({});
  const codex = listProviders().find((p) => p.id === "codex");
  assert.equal(codex.auth.mode, "none");
  assert.equal(codex.configured, false);
});
