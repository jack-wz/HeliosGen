/**
 * Shared helper for browser-side processing nodes: preview the produced image
 * immediately as a data URL, then persist it through /api/upload so the node
 * carries a durable /generated/... URL (r2Url) that survives reloads and feeds
 * downstream generation nodes.
 */
import type { NodeData } from "./store";

type UpdateNodeData = (id: string, data: Partial<NodeData>) => void;

export async function persistNodeImage(
  updateNodeData: UpdateNodeData,
  id: string,
  dataUrl: string,
  extra?: Partial<NodeData>,
): Promise<void> {
  updateNodeData(id, { imageUrl: dataUrl, status: "done", errorMsg: undefined, ...extra });
  try {
    const r = await fetch("/api/upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl, folder: "uploads" }),
    });
    if (!r.ok) throw new Error("upload failed: " + r.status);
    const { cdnUrl } = (await r.json()) as { cdnUrl?: string };
    if (!cdnUrl) throw new Error("upload returned no cdnUrl");
    updateNodeData(id, { imageUrl: cdnUrl, r2Url: cdnUrl });
  } catch (e) {
    // storage unavailable — the data-URL preview stays as fallback, but warn
    // the user that the result is not durable (it disappears on reload).
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("[persistNodeImage] upload failed:", msg);
    updateNodeData(id, { persistWarning: "Not saved to library — reload will lose this image (" + msg + ")" });
  }
}
