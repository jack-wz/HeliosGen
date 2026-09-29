import { getKieApiToken, getAzureApiKey } from "@/lib/guest/db";

export type Capability = "text" | "image" | "video" | "audio" | "embedding";
export type ProviderDefinition = {
  id: string; name: string; kind: "builtin" | "custom";
  capabilities: Capability[]; models: string[];
  auth: { mode: "api_key" | "oauth" | "none"; secretRef?: string };
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

function configured(id: string): boolean {
  if (id === "kie") return !!getKieApiToken();
  if (id === "azure") return !!getAzureApiKey();
  return false;
}

export function listProviders() {
  return BUILTINS.map((p) => ({ ...p, configured: configured(p.id), secretRef: undefined }));
}
export function getProvider(id: string) { return listProviders().find((p) => p.id === id) ?? null; }
export function providerCapabilities() { return BUILTINS.flatMap((p) => p.capabilities.map((cap) => ({ providerId: p.id, capability: cap }))); }
