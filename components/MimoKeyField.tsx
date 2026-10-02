"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";

/**
 * MiMo API key field for Settings → API Keys.
 *
 * Self-contained on purpose: it owns its state and talks to
 * /api/settings/mimo-key directly, so adding it does not mean threading four
 * more props through the settings panel.
 *
 * The key powers asset classification (lib/assetVision.ts). Without it the
 * feature reports `vision_not_configured` rather than failing obscurely, so
 * this field is the one place that turns it on.
 */
export function MimoKeyField() {
  const t = useTranslations("settings");
  const [status, setStatus] = useState<"unknown" | "set" | "unset">("unknown");
  const [input, setInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mirrors how SettingsModal reads the other key statuses: a .then() chain
  // inside the effect rather than an awaited call, so nothing sets state
  // synchronously during the effect.
  useEffect(() => {
    fetch("/api/settings/mimo-key")
      .then((r) => r.json())
      .then((d: { hasKey?: boolean }) => setStatus(d.hasKey ? "set" : "unset"))
      .catch(() => setStatus("unset"));
  }, []);

  const save = async () => {
    if (!input.trim()) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/settings/mimo-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mimoApiKey: input.trim() }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Failed to save");
      }
      setInput("");
      setStatus("set");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    setSaving(true);
    setError(null);
    try {
      await fetch("/api/settings/mimo-key", { method: "DELETE" });
      setStatus("unset");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to remove");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        display: "flex", flexDirection: "column", gap: "10px", padding: "16px",
        background: "rgba(251,146,60,0.04)", border: "1px solid rgba(251,146,60,0.14)", borderRadius: "12px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <span
          style={{
            width: "28px", height: "28px", borderRadius: "7px",
            background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.2)",
            display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px",
          }}
        >
          👁
        </span>
        <div>
          <div style={{ fontSize: "13px", fontWeight: 600, color: "rgba(255,255,255,0.85)" }}>Xiaomi MiMo</div>
          <div style={{ fontSize: "10px", color: "rgba(255,255,255,0.28)", marginTop: "1px" }}>
            {t("mimoHint")}
          </div>
        </div>
        {status === "set" && (
          <span
            style={{
              marginLeft: "auto", fontSize: "10px", fontWeight: 600,
              color: "rgba(74,222,128,0.8)", background: "rgba(74,222,128,0.08)",
              border: "1px solid rgba(74,222,128,0.2)", borderRadius: "5px", padding: "2px 7px",
            }}
          >
            {t("configured")}
          </span>
        )}
      </div>

      {status === "set" ? (
        <div style={{ display: "flex", gap: "8px" }}>
          <input
            type="password"
            value="placeholdertoken"
            readOnly
            aria-label="MiMo API key (configured)"
            style={{
              flex: 1, padding: "7px 10px", borderRadius: "7px",
              border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)",
              color: "rgba(255,255,255,0.3)", fontSize: "12px", cursor: "default", outline: "none",
            }}
          />
          <button
            onClick={remove}
            disabled={saving}
            style={{
              padding: "7px 12px", borderRadius: "7px", border: "1px solid rgba(239,68,68,0.3)",
              background: "rgba(239,68,68,0.06)", color: "rgba(239,68,68,0.7)",
              cursor: "pointer", fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
            }}
          >
            {t("remove")}
          </button>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <div style={{ display: "flex", gap: "8px" }}>
            <input
              type="password"
              placeholder={t("mimoPlaceholder")}
              aria-label={t("mimoPlaceholder")}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") void save(); }}
              style={{
                flex: 1, padding: "7px 10px", borderRadius: "7px",
                border: "1px solid rgba(255,255,255,0.08)", background: "rgba(255,255,255,0.04)",
                color: "rgba(255,255,255,0.85)", fontSize: "12px", outline: "none",
              }}
            />
            <button
              onClick={save}
              disabled={!input.trim() || saving}
              style={{
                padding: "7px 14px", borderRadius: "7px", border: "none",
                background: input.trim() ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.04)",
                color: input.trim() ? "rgba(255,255,255,0.85)" : "rgba(255,255,255,0.25)",
                cursor: input.trim() ? "pointer" : "default",
                fontSize: "12px", fontWeight: 500, whiteSpace: "nowrap",
              }}
            >
              {saving ? t("saving") : t("save")}
            </button>
          </div>
          {error && <p style={{ fontSize: "11px", color: "rgba(239,68,68,0.7)", margin: 0 }}>{error}</p>}
          <p style={{ fontSize: "10px", color: "rgba(255,255,255,0.2)", margin: 0, lineHeight: 1.5 }}>
            {t("mimoGetKey")}{" "}
            <a href="https://platform.xiaomimimo.com" target="_blank" rel="noreferrer" style={{ color: "rgba(255,255,255,0.4)" }}>
              platform.xiaomimimo.com
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
