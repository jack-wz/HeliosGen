/**
 * Identify a media file by its leading bytes rather than its extension.
 *
 * Why this exists: originals are stored with their original extension and every
 * existing reference — workflow node data, the DB, the asset index — points at
 * `/generated/images/<id>.png`. Compressing those files means replacing PNG
 * bytes with lossless WebP bytes *at the same path*, so the URL keeps working
 * and nothing needs rewriting. That only holds up if the server reports the
 * type the bytes actually are, which the extension can no longer be trusted for.
 *
 * Reads 12 bytes; returns null for anything it does not recognise, and callers
 * fall back to the extension.
 */
import { openSync, readSync, closeSync } from "fs";

const SNIFF_BYTES = 12;

export function sniffMediaType(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(filePath, "r");
    const buf = Buffer.alloc(SNIFF_BYTES);
    const read = readSync(fd, buf, 0, SNIFF_BYTES, 0);
    if (read < 4) return null;

    // PNG: 89 50 4E 47 0D 0A 1A 0A
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) return "image/png";
    // JPEG: FF D8 FF
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
    // GIF: "GIF8"
    if (buf.toString("ascii", 0, 4) === "GIF8") return "image/gif";
    // WebP: "RIFF" .... "WEBP"
    if (read >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
      return "image/webp";
    }
    // AVIF / HEIC: ....ftyp{avif,avis,heic,heix,mif1}
    if (read >= 12 && buf.toString("ascii", 4, 8) === "ftyp") {
      const brand = buf.toString("ascii", 8, 12);
      if (brand.startsWith("avi")) return "image/avif";
      if (brand.startsWith("hei") || brand === "mif1") return "image/heic";
      return "video/mp4";
    }
    // WebM / Matroska: 1A 45 DF A3
    if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return "video/webm";
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) closeSync(fd);
  }
}

/** Sniffed type when the bytes are recognisable, otherwise the extension's type. */
export function resolveMediaType(filePath: string, byExtension: string): string {
  return sniffMediaType(filePath) ?? byExtension;
}
