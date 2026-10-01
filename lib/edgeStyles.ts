import type { CSSProperties } from "react";

// Colours match the handle border colours exactly
export const EDGE_COLORS: Record<string, string> = {
  prompt: "var(--primary)", // teal   — matches node-handle-icon-prompt
  image: "var(--role-resource)", // orange — matches node-handle-icon-resource
  startFrame: "var(--accent-indigo)", // indigo — matches node-handle-icon-image
  endFrame: "var(--accent-indigo)", // indigo — matches node-handle-icon-image
  resource: "var(--role-resource)", // orange — matches node-handle-icon-resource
  videoRef: "var(--role-video)", // cyan   — matches node-handle-icon-videoref
  referenceVideo: "var(--role-refvideo)", // sky    — matches node-handle-icon-refvideo
  audioRef: "var(--accent-violet)", // violet — matches node-handle-icon-audioref
  character: "#f472b6", // pink   — matches node-handle-icon-character (motion control startFrame)
  default: "#3a3a3a", // neutral
};

// Handles that carry image data get a heavier stroke
const IMAGE_HANDLES = new Set(["image", "startFrame", "endFrame", "resource"]);

export function edgeStyle(targetHandle?: string | null | undefined): CSSProperties {
  const key = targetHandle ?? "default";
  const color = EDGE_COLORS[key] ?? EDGE_COLORS.default;
  const strokeWidth = IMAGE_HANDLES.has(key) ? 2.5 : 2;
  return { stroke: color, strokeWidth };
}

/** Returns the stroke color for a source (output) handle. */
export function getSourceHandleColor(nodeType: string | undefined, sourceHandleId: string | null | undefined): string {
  switch (sourceHandleId) {
    case "startFrameOut":
    case "endFrameOut":
    case "imagePickOut": return "var(--accent-indigo)";
    case "videoRefOut": return "var(--role-video)";
    case "audioRefOut": return "var(--accent-violet)";
  }
  // Legacy / single-output nodes — derive from node type
  switch (nodeType) {
    case "promptNode": return "var(--primary)";
    case "assistantNode": return "var(--role-assistant)";
    case "imageInputNode": return "var(--accent-indigo)";
    case "generateNode": return "var(--accent-indigo)";
    case "videoInputNode": return "var(--role-video)";
    case "videoGeneratorNode": return "var(--role-video)";
    default: return EDGE_COLORS.default;
  }
}
