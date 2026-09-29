/**
 * Browser-side image resize via canvas.
 * Ported from node-banana (MIT, github.com/shrimbly/node-banana) src/utils/imageResize.ts.
 */

export type ImageResizeMode = "exact" | "maxEdge" | "scale";
export type ImageResizeFit = "contain" | "cover" | "stretch";
export type ImageResizeFormat = "keep" | "png" | "jpeg" | "webp";

export interface ResizeOptions {
  mode: ImageResizeMode;
  width: number;
  height: number;
  maxEdge: number;
  scalePct: number;
  fit: ImageResizeFit;
  format: ImageResizeFormat;
  quality: number;
}

export interface ResizeResult {
  dataUrl: string;
  width: number;
  height: number;
  bytes: number;
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to load image"));
    img.src = src;
  });
}

/** Cap on the longest output edge so a huge exact size cannot allocate a
 *  multi-hundred-MB canvas that freezes the browser. */
const MAX_EDGE = 8192;

function capToMaxEdge(width: number, height: number): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= MAX_EDGE) return { width, height };
  const scale = MAX_EDGE / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function computeTargetSize(
  srcW: number,
  srcH: number,
  opts: Pick<ResizeOptions, "mode" | "width" | "height" | "maxEdge" | "scalePct">,
): { width: number; height: number } {
  if (opts.mode === "exact") {
    return capToMaxEdge(Math.max(1, Math.round(opts.width)), Math.max(1, Math.round(opts.height)));
  }
  if (opts.mode === "maxEdge") {
    const longest = Math.max(srcW, srcH);
    if (longest <= 0) return { width: 1, height: 1 };
    const scale = Math.min(1, opts.maxEdge / longest);
    return {
      width: Math.max(1, Math.round(srcW * scale)),
      height: Math.max(1, Math.round(srcH * scale)),
    };
  }
  const s = Math.max(0.01, opts.scalePct / 100);
  return capToMaxEdge(Math.max(1, Math.round(srcW * s)), Math.max(1, Math.round(srcH * s)));
}

function pickMime(format: ImageResizeFormat, sourceMime: string | null): string {
  if (format === "png") return "image/png";
  if (format === "jpeg") return "image/jpeg";
  if (format === "webp") return "image/webp";
  if (sourceMime === "image/jpeg" || sourceMime === "image/webp" || sourceMime === "image/png") {
    return sourceMime;
  }
  return "image/png";
}

function detectMime(dataUrl: string): string | null {
  const m = /^data:([^;,]+)[;,]/i.exec(dataUrl);
  return m ? m[1] : null;
}

/** Approximate decoded byte size from a data URL (base64 4:3 ratio). */
export function approxBytesFromDataUrl(dataUrl: string): number {
  const idx = dataUrl.indexOf(",");
  if (idx < 0) return dataUrl.length;
  const b64 = dataUrl.slice(idx + 1);
  const padding = b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((b64.length * 3) / 4) - padding);
}

/** Resize an image. Returns a data URL. */
export async function resizeImage(src: string, opts: ResizeOptions): Promise<ResizeResult> {
  const img = await loadImage(src);
  const target = computeTargetSize(img.naturalWidth, img.naturalHeight, opts);

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas 2d context");

  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";

  if (opts.fit === "stretch") {
    ctx.drawImage(img, 0, 0, target.width, target.height);
  } else {
    const srcAspect = img.naturalWidth / img.naturalHeight;
    const tgtAspect = target.width / target.height;
    let dw: number;
    let dh: number;
    if (opts.fit === "contain") {
      if (srcAspect > tgtAspect) {
        dw = target.width;
        dh = target.width / srcAspect;
      } else {
        dh = target.height;
        dw = target.height * srcAspect;
      }
    } else {
      // cover
      if (srcAspect > tgtAspect) {
        dh = target.height;
        dw = target.height * srcAspect;
      } else {
        dw = target.width;
        dh = target.width / srcAspect;
      }
    }
    const dx = (target.width - dw) / 2;
    const dy = (target.height - dh) / 2;
    ctx.drawImage(img, dx, dy, dw, dh);
  }

  const mime = pickMime(opts.format, detectMime(src));
  const useQuality = mime === "image/jpeg" || mime === "image/webp";
  const dataUrl = useQuality
    ? canvas.toDataURL(mime, Math.max(0, Math.min(1, opts.quality)))
    : canvas.toDataURL(mime);

  return { dataUrl, width: target.width, height: target.height, bytes: approxBytesFromDataUrl(dataUrl) };
}
