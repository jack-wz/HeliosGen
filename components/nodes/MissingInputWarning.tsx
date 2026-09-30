"use client";
import { useState } from "react";

export default function MissingInputWarning({ messages }: { messages: string[] }) {
  const [visible, setVisible] = useState(false);
  if (messages.length === 0) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: -20,
        right: 2,
        zIndex: 20,
        pointerEvents: "auto",
      }}
      onMouseEnter={() => setVisible(true)}
      onMouseLeave={() => setVisible(false)}
    >
      {/* Red triangle */}
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" style={{ display: "block", cursor: "default" }}>
        <path
          d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"
          fill="var(--destructive)"
        />
        <line x1="12" y1="9" x2="12" y2="13" stroke="white" strokeWidth="2" strokeLinecap="round" />
        <line x1="12" y1="17" x2="12.01" y2="17" stroke="white" strokeWidth="2" strokeLinecap="round" />
      </svg>

      {/* Tooltip — opens downward, aligned to the right of the icon */}
      {visible && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 5px)",
            right: 0,
            background: "#1A1A1A",
            border: "1px solid rgba(239,68,68,0.3)",
            borderRadius: 6,
            padding: "5px 9px",
            whiteSpace: "nowrap",
            fontSize: 11,
            color: "#CCCCCC",
            boxShadow: "0 4px 14px rgba(0,0,0,0.55)",
            zIndex: 200,
            pointerEvents: "none",
          }}
        >
          {messages.map((msg, i) => (
            <div key={i} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--destructive)", fontSize: 8 }}>●</span>
              {msg}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
