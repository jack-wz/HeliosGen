function copyTextFallback(text: string): void {
  if (typeof document === "undefined" || !document.body) {
    throw new Error("Clipboard is unavailable");
  }

  const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const input = active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
  const inputSelection = input && input.selectionStart !== null
    ? { start: input.selectionStart, end: input.selectionEnd!, direction: input.selectionDirection }
    : null;
  const selection = document.getSelection();
  const ranges = selection
    ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange())
    : [];
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.readOnly = true;
  textarea.tabIndex = -1;
  textarea.setAttribute("aria-hidden", "true");
  textarea.style.cssText = "position:fixed;left:-9999px;top:0;opacity:0;font-size:16px;";
  document.body.appendChild(textarea);

  try {
    textarea.focus({ preventScroll: true });
    textarea.select();
    textarea.setSelectionRange(0, text.length);
    if (!document.execCommand("copy")) throw new Error("Could not copy to clipboard");
  } finally {
    textarea.remove();
    active?.focus({ preventScroll: true });
    if (input && inputSelection) {
      input.setSelectionRange(inputSelection.start, inputSelection.end, inputSelection.direction ?? undefined);
    }
    if (selection) {
      selection.removeAllRanges();
      ranges.forEach((range) => selection.addRange(range));
    }
  }
}

export function copyText(text: string): Promise<void> {
  try {
    if (typeof navigator !== "undefined" && typeof navigator.clipboard?.writeText === "function") {
      return navigator.clipboard.writeText(text).catch(() => copyTextFallback(text));
    }
  } catch {
    // Some browsers throw before returning a clipboard promise.
  }

  try {
    // Keep the HTTP fallback in the original click or keyboard event.
    copyTextFallback(text);
    return Promise.resolve();
  } catch (error) {
    return Promise.reject(error);
  }
}
