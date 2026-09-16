import type { RoofParams, Point2D } from "../types";

export interface RoofFootprint {
  /** Closed outline in plan-view mm, mapped from the engine's X/Z ground
   *  plane (same convention generateGeometry() uses -- Y is height). */
  outline: Point2D[];
  ridgeLine?: { start: Point2D; end: Point2D };
  width: number;
  depth: number;
}

/**
 * Plan-view footprint math mirrors each roof class's own generateGeometry()
 * exactly (same halfW/halfL/ridge formulas) but only needs the params, not a
 * constructed instance -- this is a 2D projection for the drawing view, not
 * a 3D mesh.
 */
export function getRoofFootprint(params: RoofParams): RoofFootprint {
  if (params.type === "gable") {
    const halfX = params.span / 2 + params.overhang;
    const halfZ = params.ridgeLength / 2;
    return {
      outline: [
        { x: -halfX, y: -halfZ },
        { x: halfX, y: -halfZ },
        { x: halfX, y: halfZ },
        { x: -halfX, y: halfZ },
      ],
      ridgeLine: { start: { x: 0, y: -halfZ }, end: { x: 0, y: halfZ } },
      width: halfX * 2,
      depth: halfZ * 2,
    };
  }

  if (params.type === "hip") {
    const halfX = params.width / 2 + params.overhang;
    const halfZ = params.length / 2 + params.overhang;
    const ridgeLength = Math.max(params.length - params.width, 0);
    const halfRidge = ridgeLength / 2;
    return {
      outline: [
        { x: -halfX, y: -halfZ },
        { x: halfX, y: -halfZ },
        { x: halfX, y: halfZ },
        { x: -halfX, y: halfZ },
      ],
      ridgeLine: ridgeLength > 0 ? { start: { x: -halfRidge, y: 0 }, end: { x: halfRidge, y: 0 } } : undefined,
      width: halfX * 2,
      depth: halfZ * 2,
    };
  }

  // shed: single slope, low edge at x=0, high edge at x=width+overhang
  const halfZ = params.length / 2;
  const run = params.width + params.overhang;
  return {
    outline: [
      { x: 0, y: -halfZ },
      { x: run, y: -halfZ },
      { x: run, y: halfZ },
      { x: 0, y: halfZ },
    ],
    width: run,
    depth: halfZ * 2,
  };
}
