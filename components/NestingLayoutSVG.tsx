"use client";

import type { NestingSheetResult, Part, ToolProfile } from "@/lib/parametric-engine/types";
import { exportNestedSheetToDXF } from "@/lib/parametric-engine/fabrication/dxf-export";

interface NestingLayoutSVGProps {
  sheet: NestingSheetResult;
  parts: Part[];
  tool: ToolProfile;
}

// Same component-role palette as the engine shipped, just swapped for tones
// that sit inside the NGS teal/amber/ink system instead of default Tailwind hues.
const PART_COLORS: Record<string, string> = {
  sheathing: "#CFE3E3",
  rafter: "#F6DFB6",
  ridge: "#E9B9AE",
  hipRafter: "#E9B9AE",
  jackRafter: "#F0C89A",
  purlin: "#CFE6D6",
  eaveBeam: "#C9D3E8",
  fascia: "#EBD3DE",
};

function boundingBox(part: Part) {
  const xs = part.outline.map((p) => p.x);
  const ys = part.outline.map((p) => p.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Renders one nested sheet so an operator can sanity-check the layout
 * before it goes near a machine, with the matching DXF as a direct
 * download. DXF generation happens client-side -- the fabrication layer
 * has no server-only dependencies.
 */
export function NestingLayoutSVG({ sheet, parts, tool }: NestingLayoutSVGProps) {
  const partById = new Map(parts.map((p) => [p.id, p]));

  const handleDownload = () => {
    const dxf = exportNestedSheetToDXF(sheet, parts, tool);
    const blob = new Blob([dxf], { type: "application/dxf" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `sheet-${sheet.sheetIndex}.dxf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="card" style={{ padding: 14, marginBottom: 12 }}>
      <div className="row-between" style={{ marginBottom: 8 }}>
        <strong style={{ fontSize: 13.5 }}>
          Sheet {sheet.sheetIndex} — {sheet.stock.width}×{sheet.stock.height}mm
          {sheet.material && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                fontWeight: 600,
                color: "var(--muted)",
                background: "var(--bg)",
                border: "1px solid var(--line)",
                padding: "2px 7px",
                borderRadius: 4,
              }}
            >
              {sheet.material}
              {sheet.thickness ? ` · ${sheet.thickness}mm` : ""}
            </span>
          )}
          {sheet.sourceRemnantId && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 11,
                fontWeight: 600,
                color: "#0B4E4F",
                background: "var(--teal-dim)",
                padding: "2px 7px",
                borderRadius: 4,
              }}
            >
              remnant
            </span>
          )}
        </strong>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <span className="helptext mono">
            {(sheet.utilization * 100).toFixed(1)}% utilization · {sheet.placements.length} parts
          </span>
          <button onClick={handleDownload} className="btn primary" style={{ padding: "5px 12px", fontSize: 12.5 }}>
            Download DXF
          </button>
        </div>
      </div>

      <svg
        viewBox={`0 0 ${sheet.stock.width} ${sheet.stock.height}`}
        style={{ width: "100%", height: "auto", background: "var(--bg)", border: "1px solid var(--line)", borderRadius: 6 }}
      >
        <rect x={0} y={0} width={sheet.stock.width} height={sheet.stock.height} fill="none" stroke="var(--ink)" strokeWidth={4} />
        {sheet.placements.map((placement, i) => {
          const part = partById.get(placement.partId);
          if (!part) return null;
          const bbox = boundingBox(part);
          const color = PART_COLORS[part.sourceComponent] ?? "#E4E6E1";
          // Inset slightly so a part that fills the whole sheet still shows
          // a visible gap from the sheet border - without this, a 100%
          // utilization single-part sheet renders as one solid rectangle
          // with the part's edge sitting exactly on the sheet's edge,
          // indistinguishable from an empty box.
          const inset = Math.min(bbox.width, bbox.height) * 0.02;
          const labelSize = Math.max(Math.min(bbox.width, bbox.height) * 0.06, 24);
          return (
            <g key={`${placement.partId}-${i}`} transform={`translate(${placement.x} ${placement.y}) rotate(${placement.rotation})`}>
              <rect
                x={inset}
                y={inset}
                width={bbox.width - inset * 2}
                height={bbox.height - inset * 2}
                fill={color}
                stroke="var(--ink)"
                strokeWidth={2}
              />
              <text x={bbox.width / 2} y={bbox.height / 2 - labelSize * 0.4} textAnchor="middle" fontSize={labelSize} fontWeight={600} fill="var(--ink)">
                {part.sourceComponent}
              </text>
              <text
                x={bbox.width / 2}
                y={bbox.height / 2 + labelSize * 0.7}
                textAnchor="middle"
                fontSize={labelSize * 0.8}
                fill="var(--muted)"
                fontFamily="monospace"
              >
                {Math.round(bbox.width)}×{Math.round(bbox.height)}mm
              </text>
              <text
                x={bbox.width / 2}
                y={bbox.height / 2 + labelSize * 1.6}
                textAnchor="middle"
                fontSize={labelSize * 0.6}
                fill="var(--muted)"
                fontFamily="monospace"
              >
                {placement.partId}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
