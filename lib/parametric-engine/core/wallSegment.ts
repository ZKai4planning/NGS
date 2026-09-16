import type { WallSegment, WallFrame } from "../types";

/**
 * Turns one straight wall segment into a WallFrame: `right` is the unit
 * vector from `start` to `end` (so a window's offset is measured "from
 * wherever the wall was drawn starting"), `up` is always +Y, and `out` is
 * `right` rotated 90 degrees in the ground plane -- i.e. out = (-rz, 0, rx)
 * for right = (rx, 0, rz). That rotation is what makes `right x up = out`
 * hold for a wall drawn at ANY angle, not just the 4 axis-aligned
 * directions buildingEnvelope.ts used to hardcode -- this function is a
 * strict generalization of that hardcoded math (verified in
 * scripts/verify-building.ts: feeding it the same 4 box corners buildingEnvelope
 * used to construct by hand reproduces the exact same 4 WallFrames).
 *
 * Which of the two perpendicular directions counts as "out" is an
 * engineering choice (there's no way to know which side of an arbitrary,
 * possibly open, wall network is "outside" without a closed floor plan and
 * a convention for winding direction) -- it only affects which face a
 * window's frame/glass visually sits toward, not whether the geometry is
 * valid.
 */
export function wallSegmentToFrame(segment: WallSegment): WallFrame {
  const dx = segment.end.x - segment.start.x;
  const dz = segment.end.y - segment.start.y; // plan Y maps to world Z
  const length = Math.hypot(dx, dz);
  if (length === 0) throw new Error(`Zero-length wall: ${segment.id}`);

  const rx = dx / length;
  const rz = dz / length;

  return {
    id: segment.id,
    width: length,
    height: segment.heightMm,
    thicknessMm: segment.thicknessMm,
    origin: { x: segment.start.x, y: 0, z: segment.start.y },
    right: { x: rx, y: 0, z: rz },
    up: { x: 0, y: 1, z: 0 },
    out: { x: -rz, y: 0, z: rx },
  };
}
