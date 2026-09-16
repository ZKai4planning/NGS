import type { RoofParams, WallFrame, WallSegment } from "../types";
import { wallSegmentToFrame } from "./wallSegment";

/**
 * Derives the 4 wall segments a roof footprint implies, at `eaveHeight`,
 * sized to the roof's actual building span/depth (never the overhang --
 * overhang is roof-only, the wall sits at the building line underneath it).
 * Uses the exact same span/depth formulas as roofFootprint.ts's plan-view
 * outline, minus the overhang term.
 *
 * These are expressed as plain WallSegment corners and handed to
 * wallSegmentToFrame() -- the same function a freeform, user-drawn wall
 * goes through -- rather than each wall's basis vectors being hand-picked
 * here. That's a deliberate consolidation: this box is really just a
 * closed 4-wall floor plan with a name for each side (north/south/east/
 * west) instead of an arbitrary id, not a geometrically special case.
 */
export function getBuildingWallSegments(params: RoofParams): WallSegment[] {
  const { halfX, halfZ } = buildingHalfExtents(params);
  const heightMm = params.eaveHeight;
  const thicknessMm = 150;

  // Walked in order so each wall's `start -> end` direction is consistent
  // with a single winding direction around the box (matters for which side
  // `out` ends up facing -- see wallSegmentToFrame's doc).
  return [
    { id: "north", start: { x: -halfX, y: halfZ }, end: { x: halfX, y: halfZ }, thicknessMm, heightMm },
    { id: "south", start: { x: halfX, y: -halfZ }, end: { x: -halfX, y: -halfZ }, thicknessMm, heightMm },
    { id: "east", start: { x: halfX, y: halfZ }, end: { x: halfX, y: -halfZ }, thicknessMm, heightMm },
    { id: "west", start: { x: -halfX, y: -halfZ }, end: { x: -halfX, y: halfZ }, thicknessMm, heightMm },
  ];
}

export function getBuildingWalls(params: RoofParams): WallFrame[] {
  return getBuildingWallSegments(params).map(wallSegmentToFrame);
}

/** Building-line (no overhang) half-extents in the roof engine's X/Z ground
 *  plane. Mirrors roofFootprint.ts's outline math for each roof type, minus
 *  the overhang term that only affects the roof, not the walls under it. */
function buildingHalfExtents(params: RoofParams): { halfX: number; halfZ: number } {
  if (params.type === "gable") {
    return { halfX: params.span / 2, halfZ: params.ridgeLength / 2 };
  }
  // hip and shed both carry width/length directly as the building footprint.
  return { halfX: params.width / 2, halfZ: params.length / 2 };
}

export function getWallByElevation(params: RoofParams, elevation: WallFrame["id"]): WallFrame {
  const wall = getBuildingWalls(params).find((w) => w.id === elevation);
  if (!wall) throw new Error(`Unknown elevation: ${elevation}`);
  return wall;
}
