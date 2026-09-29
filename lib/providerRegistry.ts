import { getKieApiToken, getAzureApiKey, getSetting } from "@/lib/guest/db";

export type Capability = "text" | "image" | "video" | "audio" | "embedding";
export type ProviderDefinition = {
  id: string; name: string; kind: "builtin" | "custom";
  capabilities: Capability[]; models: string[];
  auth: { mode: "api_key" | "oauth" | "none"; secretRef?: string };
};

/**
 * Shape that is safe to return from a route. `auth.secretRef` is deliberately
 * dropped: it names the settings row that holds the API key, and the previous
 * `{ ...p, secretRef: undefined }` stripped nothing (the reference lives on
 * `auth`, and JSON.stringify drops `undefined` anyway).
 */
export type PublicProvider = Omit<ProviderDefinition, "auth"> & {
  auth: { mode: ProviderDefinition["auth"]["mode"] };
  configured: boolean;
};

const BUILTINS: ProviderDefinition[] = [
  { id: "kie", name: "Kie.ai", kind: "builtin", capabilities: ["image", "video"], models: [], auth: { mode: "api_key", secretRef: "kie_api_token" } },
  { id: "fal", name: "fal.ai", kind: "builtin", capabilities: ["image", "video", "audio"], models: [], auth: { mode: "api_key", secretRef: "fal_api_key" } },
  { id: "replicate", name: "Replicate", kind: "builtin", capabilities: ["image", "video", "audio"], models: [], auth: { mode: "api_key", secretRef: "replicate_api_key" } },
  { id: "gemini", name: "Google Gemini", kind: "builtin", capabilities: ["text", "image", "video"], models: [], auth: { mode: "api_key", secretRef: "gemini_api_key" } },
  { id: "openai", name: "OpenAI", kind: "builtin", capabilities: ["text", "image", "audio", "embedding"], models: [], auth: { mode: "api_key", secretRef: "openai_api_key" } },
  { id: "wavespeed", name: "WaveSpeed", kind: "builtin", capabilities: ["image", "video"], models: [], auth: { mode: "api_key", secretRef: "wavespeed_api_key" } },
  { id: "azure", name: "Azure Foundry", kind: "builtin", capabilities: ["text", "image", "video"], models: [], auth: { mode: "api_key", secretRef: "azure_api_key" } },
  { id: "codex", name: "Codex CLI", kind: "builtin", capabilities: ["text"], models: [], auth: { mode: "none" } },
];

/**
 * Single definition of "configured" for every surface. The env fallbacks in
 * getKieApiToken/getAzureApiKey must be honoured here too, otherwise the list
 * and the per-provider route disagree about the same provider.
 */
function isConfigured(p: ProviderDefinition): boolean {
  if (p.id === "kie") return !!getKieApiToken();
  if (p.id === "azure") return !!getAzureApiKey();
  if (!p.auth.secretRef) return false;
  return !!getSetting(p.auth.secretRef);
}

export function listProviders(): PublicProvider[] {
  return BUILTINS.map((p) => ({
    id: p.id,
    name: p.name,
    kind: p.kind,
    capabilities: p.capabilities,
    models: p.models,
    auth: { mode: p.auth.mode },
    configured: isConfigured(p),
  }));
}

export function getProvider(id: string): PublicProvider | null {
  return listProviders().find((p) => p.id === id) ?? null;
}

/** Internal only — carries `auth.secretRef`. Never return this from a route. */
export function getProviderDefinition(id: string): ProviderDefinition | null {
  return BUILTINS.find((p) => p.id === id) ?? null;
}
export function providerCapabilities() { return BUILTINS.flatMap((p) => p.capabilities.map((cap) => ({ providerId: p.id, capability: cap }))); }
