"use client";

import { useCallback } from "react";
import { useTranslations } from "next-intl";

/** The error shape our API routes return: a readable message plus a stable code. */
export type ApiErrorPayload = { error?: string; code?: string } | null | undefined;

/**
 * Resolve an API error for display.
 *
 * Routes send both `error` (English, human-readable — and the field the CLI and
 * MCP clients surface to agents) and a stable `code`. When the code is one we
 * have a translation for, show that; otherwise fall back to the API's own text.
 * That way an unrecognised code degrades to English rather than rendering a raw
 * key like `file_too_large_100mb`, and adding a code server-side never requires
 * a matching frontend change to stay safe.
 */
export function useApiError() {
  const t = useTranslations("errors");
  // Memoised on `t`, which next-intl keeps stable per locale — so this is safe
  // to list in a dependency array without rebuilding the caller every render.
  return useCallback(
    (payload: ApiErrorPayload, fallback: string): string => {
      const code = payload?.code;
      if (code && t.has(code)) return t(code);
      return payload?.error ?? fallback;
    },
    [t],
  );
}
