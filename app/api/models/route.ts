/**
 * GET /api/models
 *
 * Machine-readable model catalog for CLI / agent clients. Derived from
 * lib/modelConfig.ts (the same registry the UI uses), so it can never drift
 * from what the server actually accepts.
 */
import { NextResponse } from "next/server";
import { IMAGE_MODELS, VIDEO_MODELS } from "@/lib/modelConfig";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    images: IMAGE_MODELS.map((m) => ({
      id: m.id,
      name: m.name,
      provider: m.provider,
      ratios: m.ratios,
      supportsImages: m.supportsImages,
      maxImages: m.maxImages,
      supportsQuality: m.supportsQuality,
      qualityOptions: m.apiInput.qualityOptions ?? ["1k", "2k", "4k"],
      promptMaxLength: m.apiInput.promptMaxLength,
    })),
    videos: VIDEO_MODELS.map((m) => {
      // Google Veo models submit through /api/v1/veo/* and have no jobs-API
      // poller (lib/kieJobPoller) — on a self-hosted/NAS deployment with no
      // public callback URL they stay pending forever.
      const nasSupported = !m.apiInput.useGoogleVeo;
      return {
        id: m.id,
        name: m.name,
        provider: m.provider,
        ratios: m.ratios,
        durations: m.durations,
        defaultDuration: m.defaultDuration,
        defaultRatio: m.defaultRatio,
        handles: m.handles,
        requiredHandles: m.requiredHandles ?? [],
        sound: m.sound,
        promptOptional: m.promptOptional ?? false,
        supportsSeeds: m.supportsSeeds ?? false,
        modes: m.modes ?? [],
        defaultMode: m.defaultMode,
        resolutions: m.resolutions ?? [],
        defaultResolution: m.defaultResolution,
        promptMaxLength: m.apiInput.promptMaxLength,
        nasSupported,
        ...(nasSupported
          ? {}
          : { note: "Requires a public callback URL; not supported on this NAS deployment." }),
      };
    }),
  });
}
