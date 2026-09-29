/**
 * Client-side background removal via IMG.LY (onnxruntime-web WASM).
 * Ported from node-banana (MIT) src/utils/backgroundRemoval.ts.
 */

export type BackgroundRemovalModel = "isnet_quint8" | "isnet_fp16" | "isnet";

export interface BackgroundRemovalOptions {
  model?: BackgroundRemovalModel;
  onProgress?: (progress: number) => void;
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Failed to convert result to data URL"));
    reader.readAsDataURL(blob);
  });
}

/**
 * Remove the background from an image using client-side AI.
 * Returns a PNG data URL with transparency.
 *
 * NOTE (memory tradeoff, from upstream): the library memoizes its WASM session
 * per model, so each quality tier stays resident for the browser session.
 * Avoid gratuitous model switching.
 */
export async function removeImageBackground(
  imageSrc: string,
  options?: BackgroundRemovalOptions,
): Promise<string> {
  const { removeBackground } = await import("@imgly/background-removal");

  const config = {
    model: options?.model ?? "isnet_fp16",
    // Self-hosted model + WASM chunks (served from MEDIA_DIR on the NAS);
    // the default staticimgly.com CDN is unreliable from some networks.
    publicPath: window.location.origin + "/generated/bgremoval/",
    output: {
      format: "image/png" as const,
      quality: 0.9,
    },
    progress: (_key: string, current: number, total: number) => {
      if (options?.onProgress && total > 0) {
        options.onProgress(Math.round((current / total) * 100));
      }
    },
  };

  const blob = await removeBackground(imageSrc, config);
  return blobToDataUrl(blob);
}
