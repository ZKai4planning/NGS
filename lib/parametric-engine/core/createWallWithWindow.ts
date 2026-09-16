import { ParametricWindow } from "./ParametricWindow";
import type { WindowParams, GeometryResult, DimensionLine } from "../types";

// Visualization-only constants -- there is no real wall design behind these
// numbers (stud spacing, insulation, cladding, etc). They exist purely so a
// window doesn't render as a flat plate floating in empty space with nothing
// to establish scale or orientation.
const WALL_MARGIN_SIDES = 600; // mm of wall visible either side of the window
const WALL_MARGIN_ABOVE = 300; // mm from head to top plate
const WALL_MARGIN_BELOW = 900; // mm from sill down toward floor level
const WALL_DEPTH = 120; // mm, wall thickness set back behind the glazing plane

export interface WallWithWindowResult {
  geometry: GeometryResult;
  dimensions: DimensionLine[];
  wallWidth: number;
  wallHeight: number;
}

/**
 * A window on its own (ParametricWindow.generateGeometry) is a flat plate
 * centered on the origin -- correct for fabrication, but meaningless to look
 * at in isolation because nothing around it establishes scale or context.
 * This wraps that same window geometry in a simple rectangular wall panel
 * with a window-sized hole, set back WALL_DEPTH behind the glazing and
 * joined to it by a reveal band, so the 3D preview reads as "a window in a
 * wall" instead of a rectangle floating in a void.
 *
 * Purely a visualization helper: it is never fed into generateParts() /
 * generateBOM() / fabrication, and it does not change what gets saved.
 *
 * Depends on ParametricWindow.generateGeometry() emitting the window's outer
 * frame ring as its first four vertices (indices 0-3) at z=0 -- true as of
 * this writing (see ParametricWindow.ts) and asserted below so a future
 * change to that ordering fails loudly here instead of silently drawing a
 * broken reveal band.
 */
export function createWallWithWindow(windowParams: WindowParams): WallWithWindowResult {
  const win = new ParametricWindow(windowParams);
  const winGeom = win.generateGeometry();
  const winDims = win.generateDimensions();

  const halfW = windowParams.width / 2;
  const halfH = windowParams.height / 2;

  // Sanity-check the ordering assumption documented above.
  const v = winGeom.vertices;
  const outerRingMatches =
    v.length >= 12 &&
    Math.abs(v[0] - -halfW) < 1e-6 &&
    Math.abs(v[1] - -halfH) < 1e-6 &&
    Math.abs(v[2]) < 1e-6 &&
    Math.abs(v[6] - halfW) < 1e-6 &&
    Math.abs(v[7] - halfH) < 1e-6;
  if (!outerRingMatches) {
    throw new Error(
      "createWallWithWindow: ParametricWindow.generateGeometry() vertex ordering changed -- update the reveal-band indices here to match."
    );
  }

  const wallHalfW = halfW + WALL_MARGIN_SIDES;
  const wallTop = halfH + WALL_MARGIN_ABOVE;
  const wallBottom = -halfH - WALL_MARGIN_BELOW;
  const wallHeight = wallTop - wallBottom;
  const z = -WALL_DEPTH;

  const base = v.length / 3; // vertex index offset for everything appended below

  // prettier-ignore
  const wallVerts = [
    -halfW, -halfH, z,      halfW, -halfH, z,      halfW, halfH, z,      -halfW, halfH, z,      // inner ring, base+0..3
    -wallHalfW, wallBottom, z,  wallHalfW, wallBottom, z,  wallHalfW, wallTop, z,  -wallHalfW, wallTop, z, // outer ring, base+4..7
  ];

  const i = (n: number) => base + n;
  const wallIndices = [
    // Wall face: inner hole to outer edge, same 4-trapezoid band pattern
    // ParametricWindow already uses for its own frame band.
    i(0), i(1), i(5), i(0), i(5), i(4),
    i(1), i(2), i(6), i(1), i(6), i(5),
    i(2), i(3), i(7), i(2), i(7), i(6),
    i(3), i(0), i(4), i(3), i(4), i(7),
    // Reveal band: connects the window's own outer ring (winGeom vertices
    // 0-3, at z=0) to the wall's inner ring (base+0..3, at z=-WALL_DEPTH).
    0, 1, i(1), 0, i(1), i(0),
    1, 2, i(2), 1, i(2), i(1),
    2, 3, i(3), 2, i(3), i(2),
    3, 0, i(0), 3, i(0), i(3),
  ];

  const geometry: GeometryResult = {
    vertices: [...v, ...wallVerts],
    indices: [...winGeom.indices, ...wallIndices],
  };

  const dimensions: DimensionLine[] = [
    ...winDims,
    { start: { x: -wallHalfW, y: wallBottom, z }, end: { x: wallHalfW, y: wallBottom, z }, label: "Wall Width", value: wallHalfW * 2 },
    { start: { x: -wallHalfW, y: wallBottom, z }, end: { x: -wallHalfW, y: wallTop, z }, label: "Wall Height", value: wallHeight },
  ];

  return { geometry, dimensions, wallWidth: wallHalfW * 2, wallHeight };
}
