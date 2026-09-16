import type { RoofParams, RoofType, WallFrame, WallSegment } from "../types";
import { detectRooms } from "./detectRooms";

export interface RoofFitResult {
  params: RoofParams;
  /** Ratio of the enclosed floor area to the bounding rectangle's area,
   *  0-1. 1.0 means the plan IS the rectangle the roof covers. */
  coverage: number;
  /** True when the footprint is (near enough) the rectangle the roof
   *  assumes, so the fitted roof is a faithful representation. */
  isRectangular: boolean;
  /** Set when the fit is approximate, explaining exactly what's wrong --
   *  shown to the user rather than silently presenting a roof that doesn't
   *  match their building. */
  warning: string | null;
}

const RECTANGULAR_COVERAGE_THRESHOLD = 0.98;

/**
 * Fits a real pitched roof (gable/hip/shed -- the same parametric roofs
 * createRoof.ts already generates and costs) over a freeform wall
 * footprint, by taking the footprint's axis-aligned bounding rectangle as
 * the roof's span/ridge-length.
 *
 * The honest limitation, surfaced rather than hidden: a gable/hip/shed
 * roof IS a rectangle. If the drawn plan is an L-shape, a T, or anything
 * non-rectangular, the bounding rectangle covers area the building doesn't
 * occupy, so the roof will overhang into empty space and the rafter/BOM
 * numbers derived from it will overstate the real roof. `coverage` and
 * `warning` report exactly that, so the fitted roof can be used as a
 * starting point without being mistaken for a correct roof over a complex
 * plan. Properly roofing an arbitrary polygon -- multiple ridges, valleys
 * where wings meet, hips at non-90-degree corners -- is a separate roof-design
 * problem, not something this bounding-box fit stands in for.
 */
export function fitRoofToFootprint(
  walls: WallSegment[],
  options: { type?: RoofType; pitch?: number; eaveHeight?: number; overhang?: number; thickness?: number } = {}
): RoofFitResult | null {
  if (walls.length === 0) return null;

  const xs = walls.flatMap((w) => [w.start.x, w.end.x]);
  const ys = walls.flatMap((w) => [w.start.y, w.end.y]);
  const width = Math.max(...xs) - Math.min(...xs);
  const length = Math.max(...ys) - Math.min(...ys);
  if (width <= 0 || length <= 0) return null;

  const type = options.type ?? "gable";
  const pitch = options.pitch ?? 30;
  // Default the eave to the tallest wall, so the roof lands on top of the
  // building rather than slicing through its tallest wall.
  const eaveHeight = options.eaveHeight ?? Math.max(...walls.map((w) => w.heightMm));
  const overhang = options.overhang ?? 500;
  const thickness = options.thickness ?? 18;

  const boundingArea = width * length;
  const rooms = detectRooms(walls);
  const enclosedArea = rooms.reduce((sum, r) => sum + r.areaMm2, 0);
  const coverage = boundingArea > 0 ? Math.min(1, enclosedArea / boundingArea) : 0;

  let warning: string | null = null;
  let isRectangular = false;
  if (rooms.length === 0) {
    warning =
      "These walls don't enclose a closed space yet, so the roof is fitted to their bounding rectangle only. Close the floor plan for an accurate fit.";
  } else if (rooms.length > 1) {
    warning = `This plan has ${rooms.length} separate enclosed areas. The roof is fitted to a single rectangle covering all of them, which won't match the real building.`;
  } else if (coverage < RECTANGULAR_COVERAGE_THRESHOLD) {
    warning = `This footprint isn't rectangular (it fills about ${Math.round(coverage * 100)}% of its bounding rectangle). A gable/hip/shed roof is rectangular, so this roof covers area the building doesn't occupy and its material estimates will be high.`;
  } else {
    isRectangular = true;
  }

  const params: RoofParams =
    type === "gable"
      ? { type: "gable", span: width, ridgeLength: length, pitch, eaveHeight, overhang, thickness }
      : type === "hip"
        ? { type: "hip", width, length, pitch, eaveHeight, overhang, thickness }
        : { type: "shed", width, length, pitch, eaveHeight, overhang, thickness };

  return { params, coverage, isRectangular, warning };
}

/** Convenience overload for when only WallFrames are on hand (e.g. the
 *  already-converted freeform walls in the project page). */
export function fitRoofToWallFrames(
  frames: WallFrame[],
  options: Parameters<typeof fitRoofToFootprint>[1] = {}
): RoofFitResult | null {
  const segments: WallSegment[] = frames.map((f) => ({
    id: f.id,
    start: { x: f.origin.x, y: f.origin.z },
    end: { x: f.origin.x + f.right.x * f.width, y: f.origin.z + f.right.z * f.width },
    thicknessMm: 150,
    heightMm: f.height,
  }));
  return fitRoofToFootprint(segments, options);
}
