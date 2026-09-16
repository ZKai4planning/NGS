"use client";

interface Pt {
  x: number;
  y: number;
}

export interface DrawingOutline {
  points: Pt[];
  closed?: boolean;
  dashed?: boolean;
}

export interface DrawingDim {
  start: Pt;
  end: Pt;
  label: string;
  /** Perpendicular distance (mm, drawing units) the dimension line sits off
   *  the geometry it's measuring. Positive = up/right of the measured edge. */
  offset: number;
}

interface Cad2DDrawingProps {
  outlines: DrawingOutline[];
  dims?: DrawingDim[];
  /** SVG y grows downward; real-world elevation/plan y usually should read
   *  upward. True flips the y axis on render (use for elevations). Plan
   *  views can leave this false -- orientation is arbitrary either way. */
  flipY?: boolean;
  heightPx?: number;
}

/**
 * Minimal CAD-style line-drawing renderer: black outlines on a light grid,
 * with dimension lines (extension lines + arrow ticks + a label) -- the
 * same visual language as the AutoCAD/DXF viewers this mirrors, just inline
 * in the app instead of requiring an external CAD viewer.
 */
export function Cad2DDrawing({ outlines, dims = [], flipY = false, heightPx = 360 }: Cad2DDrawingProps) {
  const allPoints: Pt[] = [
    ...outlines.flatMap((o) => o.points),
    ...dims.flatMap((d) => [
      offsetPoint(d.start, d, flipY),
      offsetPoint(d.end, d, flipY),
    ]),
  ];

  if (allPoints.length === 0) {
    return null;
  }

  const xs = allPoints.map((p) => p.x);
  const ys = allPoints.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1);
  const spanY = Math.max(maxY - minY, 1);
  const pad = Math.max(spanX, spanY) * 0.12;

  const viewMinX = minX - pad;
  const viewMinY = minY - pad;
  const viewW = spanX + pad * 2;
  const viewH = spanY + pad * 2;

  const gridStep = niceGridStep(Math.max(viewW, viewH));
  const gridLines = buildGrid(viewMinX, viewMinY, viewW, viewH, gridStep);

  const tickSize = Math.max(viewW, viewH) * 0.008;
  const fontSize = Math.max(viewW, viewH) * 0.022;

  const sy = (y: number) => (flipY ? -y : y);

  return (
    <svg
      viewBox={`${viewMinX} ${flipY ? -(viewMinY + viewH) : viewMinY} ${viewW} ${viewH}`}
      style={{ width: "100%", height: heightPx, background: "#fff", border: "1px solid var(--line)", borderRadius: 10 }}
    >
      <g stroke="#EEF0EC" strokeWidth={Math.max(viewW, viewH) * 0.0015}>
        {gridLines.map((l, i) => (
          <line key={i} x1={l.x1} y1={sy(l.y1)} x2={l.x2} y2={sy(l.y2)} />
        ))}
      </g>

      {outlines.map((o, i) => {
        const d =
          o.points.map((p, j) => `${j === 0 ? "M" : "L"} ${p.x} ${sy(p.y)}`).join(" ") + (o.closed !== false ? " Z" : "");
        return (
          <path
            key={i}
            d={d}
            fill="none"
            stroke="var(--ink)"
            strokeWidth={Math.max(viewW, viewH) * 0.003}
            strokeDasharray={o.dashed ? `${gridStep * 0.08} ${gridStep * 0.05}` : undefined}
          />
        );
      })}

      {dims.map((dim, i) => {
        const a = offsetPoint(dim.start, dim, flipY);
        const b = offsetPoint(dim.end, dim, flipY);
        const mid = { x: (a.x + b.x) / 2, y: (sy(a.y) + sy(b.y)) / 2 };
        const horizontal = Math.abs(a.x - b.x) >= Math.abs(dim.start.y - dim.end.y);
        return (
          <g key={`dim-${i}`} stroke="var(--amber)" strokeWidth={Math.max(viewW, viewH) * 0.0018} fill="var(--amber)">
            {/* extension lines back to the actual geometry */}
            <line x1={dim.start.x} y1={sy(dim.start.y)} x2={a.x} y2={sy(a.y)} strokeDasharray={`${tickSize} ${tickSize}`} opacity={0.6} />
            <line x1={dim.end.x} y1={sy(dim.end.y)} x2={b.x} y2={sy(b.y)} strokeDasharray={`${tickSize} ${tickSize}`} opacity={0.6} />
            {/* dimension line */}
            <line x1={a.x} y1={sy(a.y)} x2={b.x} y2={sy(b.y)} />
            {/* end ticks */}
            <line x1={a.x - (horizontal ? 0 : tickSize)} y1={sy(a.y) - (horizontal ? tickSize : 0)} x2={a.x + (horizontal ? 0 : tickSize)} y2={sy(a.y) + (horizontal ? tickSize : 0)} />
            <line x1={b.x - (horizontal ? 0 : tickSize)} y1={sy(b.y) - (horizontal ? tickSize : 0)} x2={b.x + (horizontal ? 0 : tickSize)} y2={sy(b.y) + (horizontal ? tickSize : 0)} />
            <text
              x={mid.x}
              y={mid.y - fontSize * 0.4}
              textAnchor="middle"
              fontSize={fontSize}
              stroke="none"
              fill="var(--ink)"
              fontFamily="'IBM Plex Mono', monospace"
            >
              {dim.label} — {Math.round(Math.hypot(dim.end.x - dim.start.x, dim.end.y - dim.start.y))}mm
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function offsetPoint(p: Pt, dim: DrawingDim, flipY: boolean): Pt {
  // Perpendicular offset from the segment direction -- works for the
  // axis-aligned dimension lines this component is used for (horizontal or
  // vertical), which covers roof plan + window elevation needs.
  const dx = dim.end.x - dim.start.x;
  const dy = dim.end.y - dim.start.y;
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  if (horizontal) {
    return { x: p.x, y: p.y + dim.offset };
  }
  return { x: p.x + dim.offset, y: p.y };
}

function niceGridStep(span: number): number {
  const raw = span / 10;
  const magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
  const residual = raw / magnitude;
  const step = residual >= 5 ? 5 : residual >= 2 ? 2 : 1;
  return step * magnitude;
}

function buildGrid(minX: number, minY: number, w: number, h: number, step: number) {
  const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
  const startX = Math.floor(minX / step) * step;
  const startY = Math.floor(minY / step) * step;
  for (let x = startX; x <= minX + w; x += step) {
    lines.push({ x1: x, y1: minY, x2: x, y2: minY + h });
  }
  for (let y = startY; y <= minY + h; y += step) {
    lines.push({ x1: minX, y1: y, x2: minX + w, y2: y });
  }
  return lines;
}
