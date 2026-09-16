import type { GeometryResult, WallFrame } from "../types";

const DEFAULT_OVERHANG_MM = 300;
const DEFAULT_THICKNESS_MM = 200;

/**
 * A flat rectangular slab sitting on top of a freeform wall footprint's
 * bounding box -- deliberately NOT a real pitched roof. A gable/hip/shed
 * roof (createRoof.ts) assumes a rectangular building; an architect-drawn
 * floor plan may not be one, and generating a structurally-real pitched
 * roof over an arbitrary polygon (valleys, hips meeting at odd angles) is
 * a real roof-design problem, not a rendering one. This exists purely so
 * the "Building" 3D view has *something* overhead to look at while a
 * freeform plan is being drawn, at the highest wall's height plus a small
 * overhang -- it carries no fabrication/BOM meaning and should not be
 * exported to DXF or costed as if it were a real roof.
 */
export function buildPlaceholderRoofGeometry(
  walls: WallFrame[],
  opts: { overhangMm?: number; thicknessMm?: number } = {}
): GeometryResult | null {
  if (walls.length === 0) return null;
  const overhang = opts.overhangMm ?? DEFAULT_OVERHANG_MM;
  const thickness = opts.thicknessMm ?? DEFAULT_THICKNESS_MM;

  const xs: number[] = [];
  const zs: number[] = [];
  let maxWallTop = 0;
  for (const wall of walls) {
    const endX = wall.origin.x + wall.right.x * wall.width;
    const endZ = wall.origin.z + wall.right.z * wall.width;
    xs.push(wall.origin.x, endX);
    zs.push(wall.origin.z, endZ);
    maxWallTop = Math.max(maxWallTop, wall.origin.y + wall.up.y * wall.height);
  }

  const minX = Math.min(...xs) - overhang;
  const maxX = Math.max(...xs) + overhang;
  const minZ = Math.min(...zs) - overhang;
  const maxZ = Math.max(...zs) + overhang;
  const yBottom = maxWallTop;
  const yTop = yBottom + thickness;

  // 8-corner box, 12 triangles (2 per face x 6 faces).
  const corners = [
    { x: minX, y: yBottom, z: minZ },
    { x: maxX, y: yBottom, z: minZ },
    { x: maxX, y: yBottom, z: maxZ },
    { x: minX, y: yBottom, z: maxZ },
    { x: minX, y: yTop, z: minZ },
    { x: maxX, y: yTop, z: minZ },
    { x: maxX, y: yTop, z: maxZ },
    { x: minX, y: yTop, z: maxZ },
  ];
  const vertices = corners.flatMap((c) => [c.x, c.y, c.z]);

  // Faces wound CCW as seen from outside the box.
  const indices = [
    0, 1, 2, 0, 2, 3, // bottom
    4, 6, 5, 4, 7, 6, // top
    0, 5, 1, 0, 4, 5, // -z side
    1, 6, 2, 1, 5, 6, // +x side
    2, 7, 3, 2, 6, 7, // +z side
    3, 4, 0, 3, 7, 4, // -x side
  ];

  return { vertices, indices };
}
