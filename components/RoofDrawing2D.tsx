"use client";

import { RoofDimensions, crossSectionPoints2D, computeCrossSection } from "@/lib/roofGeometry";

export default function RoofDrawing2D({ dims }: { dims: RoofDimensions }) {
  const pts = crossSectionPoints2D(dims);
  const { areaM2 } = computeCrossSection(dims);

  // Fit the span/rise into a fixed drawing box with padding.
  const boxW = 560;
  const boxH = 260;
  const pad = 60;
  const scaleX = (boxW - pad * 2) / pts.spanM;
  const scaleY = (boxH - pad * 2) / Math.max(pts.riseM, 0.1);
  const scale = Math.min(scaleX, scaleY);

  const toSvg = (x: number, y: number) => ({
    x: pad + x * scale,
    y: boxH - pad - y * scale,
  });

  const eaveL = toSvg(pts.eaveLeft.x, pts.eaveLeft.y);
  const ridge = toSvg(pts.ridge.x, pts.ridge.y);
  const eaveR = toSvg(pts.eaveRight.x, pts.eaveRight.y);

  return (
    <svg viewBox={`0 0 ${boxW} ${boxH + 40}`} width="100%" height="100%">
      <polygon
        points={`${eaveL.x},${eaveL.y} ${ridge.x},${ridge.y} ${eaveR.x},${eaveR.y}`}
        fill="#e7eeea"
        stroke="#1c2430"
        strokeWidth={2.5}
      />
      <line
        x1={ridge.x}
        y1={ridge.y}
        x2={ridge.x}
        y2={eaveL.y}
        stroke="#0f7173"
        strokeWidth={1.5}
        strokeDasharray="5 4"
      />
      <text x={ridge.x + 10} y={(ridge.y + eaveL.y) / 2} fontSize={11.5} fill="#69727d" fontWeight={600}>
        {dims.pitchDeg}° pitch
      </text>

      {/* span dimension */}
      <line x1={eaveL.x} y1={boxH} x2={eaveR.x} y2={boxH} stroke="#d98e2b" strokeWidth={1} />
      <text x={(eaveL.x + eaveR.x) / 2} y={boxH + 20} fontSize={11} fill="#d98e2b" fontFamily="monospace" textAnchor="middle">
        {pts.spanM.toFixed(2)} m span
      </text>

      {/* rise dimension */}
      <line x1={eaveR.x + 25} y1={ridge.y} x2={eaveR.x + 25} y2={eaveL.y} stroke="#d98e2b" strokeWidth={1} />
      <text
        x={eaveR.x + 35}
        y={(ridge.y + eaveL.y) / 2}
        fontSize={11}
        fill="#d98e2b"
        fontFamily="monospace"
      >
        {pts.riseM.toFixed(2)} m rise
      </text>

      <text x={pad} y={20} fontSize={12} fill="#1c2430" fontWeight={600}>
        {areaM2} m² total roof area
      </text>
    </svg>
  );
}
