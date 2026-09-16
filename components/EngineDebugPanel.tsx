"use client";

import { useEffect, useState } from "react";
import type { RoofCalculations, BOMLineItem, StructureMember } from "@/lib/parametric-engine/types";

const STORAGE_KEY = "ngs:engineDebugPanelEnabled";

interface EngineDebugPanelProps {
  /** Raw calculate() output for whatever component is currently previewed. */
  calculations: RoofCalculations;
  bom: BOMLineItem[];
  /** Optional: structural members (rafters, hips, etc). Omit if not relevant. */
  members?: StructureMember[];
  /** Label shown in the tab/popup header, e.g. "Gable · verified". */
  label?: string;
}

/**
 * Dev/debug aid, not customer-facing chrome. Sits as a slim tab on the
 * right edge of the viewport. Click it to see the exact numbers the engine
 * just computed for the current params -- the same values verify-engine.ts
 * checks -- without opening devtools or re-reading the console dump.
 *
 * Fully self-contained: reads/writes its own "enabled" flag in
 * localStorage so "disable" persists across reloads without touching any
 * app state. When disabled it shrinks to a small dot in the same corner
 * instead of disappearing entirely, so it's never truly lost.
 */
export function EngineDebugPanel({ calculations, bom, members, label }: EngineDebugPanelProps) {
  const [enabled, setEnabled] = useState(true);
  const [open, setOpen] = useState(false);

  // Read persisted preference after mount (avoids SSR/client markup mismatch).
  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === "false") setEnabled(false);
  }, []);

  function disable() {
    setEnabled(false);
    setOpen(false);
    window.localStorage.setItem(STORAGE_KEY, "false");
  }

  function enable() {
    setEnabled(true);
    window.localStorage.setItem(STORAGE_KEY, "true");
  }

  if (!enabled) {
    return (
      <button
        onClick={enable}
        title="Show engine values"
        style={{
          position: "fixed",
          top: "50%",
          right: 0,
          transform: "translateY(-50%)",
          width: 10,
          height: 10,
          borderRadius: "50% 0 0 50%",
          background: "var(--line)",
          border: "none",
          cursor: "pointer",
          zIndex: 40,
          padding: 0,
        }}
      />
    );
  }

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          top: "50%",
          right: 0,
          transform: "translateY(-50%)",
          zIndex: 40,
          background: "var(--ink)",
          color: "#fff",
          border: "none",
          borderRadius: "8px 0 0 8px",
          padding: "10px 7px",
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: 11,
          letterSpacing: ".04em",
          writingMode: "vertical-rl",
          textOrientation: "mixed",
          cursor: "pointer",
          boxShadow: "0 2px 8px rgba(0,0,0,0.15)",
        }}
      >
        ENGINE VALUES
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: "fixed",
            inset: 0,
            background: "rgba(28,36,48,0.35)",
            zIndex: 50,
            display: "flex",
            justifyContent: "flex-end",
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: "min(420px, 92vw)",
              height: "100%",
              background: "var(--panel)",
              borderLeft: "1px solid var(--line)",
              padding: "20px 22px",
              overflowY: "auto",
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: 12.5,
              color: "var(--ink)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontSize: 15 }}>Engine values{label ? ` — ${label}` : ""}</h3>
              <button
                onClick={() => setOpen(false)}
                style={{ border: "none", background: "none", cursor: "pointer", fontSize: 18, color: "var(--muted)" }}
                aria-label="Close"
              >
                ×
              </button>
            </div>

            <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 8 }}>
              Calculations
            </h4>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
              <tbody>
                {Object.entries(calculations).map(([key, value]) => (
                  <tr key={key} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "5px 0", color: "var(--muted)" }}>{key}</td>
                    <td style={{ padding: "5px 0", textAlign: "right" }}>
                      {typeof value === "number" ? value.toFixed(3) : String(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {members && members.length > 0 && (
              <>
                <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 8 }}>
                  Structure
                </h4>
                <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
                  <tbody>
                    {members.map((m) => (
                      <tr key={m.id} style={{ borderBottom: "1px solid var(--line)" }}>
                        <td style={{ padding: "5px 0", color: "var(--muted)" }}>
                          {m.role} × {m.quantity}
                        </td>
                        <td style={{ padding: "5px 0", textAlign: "right" }}>{m.length.toFixed(1)} mm</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}

            <h4 style={{ fontSize: 11, textTransform: "uppercase", letterSpacing: ".05em", color: "var(--muted)", marginBottom: 8 }}>
              BOM
            </h4>
            <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 24 }}>
              <tbody>
                {bom.map((line, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid var(--line)" }}>
                    <td style={{ padding: "5px 0", color: "var(--muted)" }}>{line.material}</td>
                    <td style={{ padding: "5px 0", textAlign: "right" }}>
                      {line.quantity} {line.unit}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <button
              onClick={disable}
              style={{
                border: "1px solid var(--line)",
                background: "none",
                borderRadius: 7,
                padding: "7px 12px",
                fontSize: 11.5,
                color: "var(--muted)",
                cursor: "pointer",
                fontFamily: "'Inter', sans-serif",
              }}
            >
              Disable panel
            </button>
          </div>
        </div>
      )}
    </>
  );
}