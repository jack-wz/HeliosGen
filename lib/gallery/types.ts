/** Shared types for the gallery screen.
 *
 * Extracted from app/gallery/page.tsx, which had grown past 7,200 lines with
 * these declarations interleaved between helpers. Behaviour is unchanged — the
 * declarations are identical, only exported.
 */

/** Local stand-in for the removed Supabase user type. */
export type User = { id: string };

export interface RefImage {
  id: string;
  objectUrl: string;
  cdnUrl: string | null;
  uploading: boolean;
  error: boolean;
}

export interface PendingGen {
  id: string;
  aspectRatio: string;
  prompt: string;
  referenceImageUrls?: string[];
  error?: string;
  taskId?: string;
  createdAt?: string;
  tab?: Tab;
  prePending?: boolean;
  retried?: boolean;
  folderId?: string | null;
}


export interface DownloadTask {
  id: string;
  filename: string;
  status: "preparing" | "ready" | "error";
}

export type Tab = "images" | "videos";

export interface TaggedImage {
  label: string;
  refId: string;
  url: string;
  kind?: "image" | "video" | "audio";
}

export interface KlingElement {
  id: string;
  name: string;
  description: string;
  imageUrls: string[];
}


export interface SavedSettings {
  prompt: string; modelId: string; aspectRatio: string;
  quality: string; count: number; duration: number; mode: string;
  sound?: boolean;
  refImageUrls?: string[];
  azureResolution?: string;
  azureCustomWidth?: number;
  azureCustomHeight?: number;
  promptTextMode?: "text" | "json" | "yaml";
  multiPromptMode?: boolean;
  vidStartFrameUrl?: string | null;
  vidEndFrameUrl?: string | null;
  vidResourceUrls?: string[];
  vidVideoRefUrl?: string | null;
  vidRefVideoUrls?: string[];
  vidRefAudioUrls?: string[];
  vidElements?: KlingElement[];
  taggedImages?: TaggedImage[];
}

