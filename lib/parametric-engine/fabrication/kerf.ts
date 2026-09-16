import type { Point2D, CutSide, ToolProfile, Part } from "../types";

/**
 * Offsets a closed polygon outward (positive) or inward (negative) by a
 * fixed distance. This is a correct, general implementation for CONVEX
 * polygons and works well for the rectangular/rectilinear parts this
 * engine produces (rafters, panels, trim). For arbitrary concave outlines
 * (complex joinery, curved fascia, etc.) swap this for a proper polygon
 * offset library such as `clipper-lib` or `polygon-offset` -- the call
 * site (offsetPartOutline) is the only place that needs to change.
 */
export function offsetPolygon(points: Point2D[], distance: number): Point2D[] {
  const n = points.length;
  if (n < 3) return points;

  const result: Point2D[] = [];

  for (let i = 0; i < n; i++) {
    const prev = points[(i - 1 + n) % n];
    const curr = points[i];
    const next = points[(i + 1) % n];

    const edge1 = normalize({ x: curr.x - prev.x, y: curr.y - prev.y });
    const edge2 = normalize({ x: next.x - curr.x, y: next.y - curr.y });

    // Outward normals (assumes CCW winding; polygons from this engine are
    // generated CCW by construction).
    const n1 = { x: edge1.y, y: -edge1.x };
    const n2 = { x: edge2.y, y: -edge2.x };

    const bisector = normalize({ x: n1.x + n2.x, y: n1.y + n2.y });
    const cosHalfAngle = bisector.x * n1.x + bisector.y * n1.y;
    const pushLength = cosHalfAngle !== 0 ? distance / cosHalfAngle : distance;

    result.push({
      x: curr.x + bisector.x * pushLength,
      y: curr.y + bisector.y * pushLength,
    });
  }

  return result;
}

function normalize(v: Point2D): Point2D {
  const len = Math.hypot(v.x, v.y) || 1;
  return { x: v.x / len, y: v.y / len };
}

/**
 * Converts a Part's NOMINAL outline into a TOOLPATH outline that accounts
 * for kerf. `side` describes which side of the line the material stays on:
 *  - "outside": cutting an external profile (part must stay full size) ->
 *    offset the toolpath outward by half the kerf so the finished part
 *    matches nominal dimensions after the tool removes material.
 *  - "inside": cutting a hole/pocket -> offset inward by half the kerf.
 *  - "online": centerline cut (e.g. separating two adjacent nested parts
 *    that share a cut line) -> no offset needed, handled by nesting spacing.
 */
export function offsetPartOutline(part: Part, tool: ToolProfile, side: CutSide): Point2D[] {
  if (side === "online") return part.outline;
  const half = tool.kerf / 2;
  const distance = side === "outside" ? half : -half;
  return offsetPolygon(part.outline, distance);
}
