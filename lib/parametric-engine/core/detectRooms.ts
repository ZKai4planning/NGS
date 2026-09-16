import type { Point2D, WallSegment } from "../types";

const JOIN_TOLERANCE_MM = 1; // endpoints this close are treated as the same corner (matches WallStudio2D's drag-join behaviour)

export interface DetectedRoom {
  /** Wall ids forming this loop, in traversal order. */
  wallIds: string[];
  /** Corner points in traversal order (first point is NOT repeated at the end). */
  outline: Point2D[];
  /** Enclosed floor area in mm^2. */
  areaMm2: number;
}

function keyOf(p: Point2D): string {
  // Quantize to the join tolerance so endpoints that were snapped together
  // (or dragged onto each other) hash to the same corner, without needing a
  // separate shared-vertex table -- walls stay independent rows whose
  // endpoints merely coincide (see WallStudio2D.startDrag).
  return `${Math.round(p.x / JOIN_TOLERANCE_MM)}:${Math.round(p.y / JOIN_TOLERANCE_MM)}`;
}

/** Shoelace formula. Returns the absolute area, so winding direction
 *  (clockwise vs counter-clockwise, which depends purely on the order the
 *  architect happened to draw the walls) doesn't flip the sign. */
function polygonArea(points: Point2D[]): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/**
 * Finds closed loops in a freeform wall network and computes each one's
 * floor area -- the "Room 1 (25.1 m2)" label an architect expects once a
 * set of walls actually encloses something.
 *
 * Deliberately simple: it walks each unvisited wall and follows
 * *unambiguous* connections (corners where exactly two wall ends meet)
 * until it returns to the start. That covers the normal case -- a room
 * drawn as a chain of walls joined end to end -- without needing a full
 * planar-graph face-finding algorithm. Walls at a junction where three or
 * more ends meet (an interior dividing wall splitting one space into two)
 * are left out rather than guessed at, because picking which way to turn
 * there is what separates "detect the obvious loop" from real planar
 * subdivision, and a wrong guess would report a confidently incorrect area.
 * Such walls simply aren't reported as rooms until that's built out.
 */
export function detectRooms(walls: WallSegment[]): DetectedRoom[] {
  if (walls.length < 3) return [];

  // corner key -> list of (wallId, which end sits at this corner)
  const corners = new Map<string, { wallId: string; end: "start" | "end" }[]>();
  for (const w of walls) {
    for (const end of ["start", "end"] as const) {
      const k = keyOf(end === "start" ? w.start : w.end);
      const list = corners.get(k) ?? [];
      list.push({ wallId: w.id, end });
      corners.set(k, list);
    }
  }

  const wallById = new Map(walls.map((w) => [w.id, w]));
  const rooms: DetectedRoom[] = [];
  const consumed = new Set<string>();

  for (const seed of walls) {
    if (consumed.has(seed.id)) continue;

    const loopWallIds: string[] = [seed.id];
    const outline: Point2D[] = [seed.start];
    let currentWall = seed;
    let currentPoint = seed.end;
    let ok = true;

    // Walk forward until we come back to the seed's start corner.
    while (keyOf(currentPoint) !== keyOf(seed.start)) {
      const atCorner = corners.get(keyOf(currentPoint)) ?? [];
      // Exactly two ends here (this wall's, plus one other) = unambiguous.
      const onward = atCorner.filter((c) => c.wallId !== currentWall.id);
      if (atCorner.length !== 2 || onward.length !== 1) {
        ok = false;
        break;
      }
      const nextRef = onward[0];
      const nextWall = wallById.get(nextRef.wallId);
      if (!nextWall || loopWallIds.includes(nextWall.id)) {
        ok = false;
        break;
      }
      outline.push(currentPoint);
      loopWallIds.push(nextWall.id);
      // Continue out the far end of the wall we just stepped onto.
      currentPoint = nextRef.end === "start" ? nextWall.end : nextWall.start;
      currentWall = nextWall;
      if (loopWallIds.length > walls.length) {
        ok = false;
        break;
      }
    }

    if (!ok || loopWallIds.length < 3) continue;

    const areaMm2 = polygonArea(outline);
    if (areaMm2 <= 0) continue;

    for (const id of loopWallIds) consumed.add(id);
    rooms.push({ wallIds: loopWallIds, outline, areaMm2 });
  }

  return rooms;
}

/** Centroid of a polygon's corners -- good enough for positioning a label
 *  inside a convex-ish room. (Vertex average, not the true area centroid:
 *  for an L-shaped room the true centroid can fall outside the shape, and
 *  a label that lands outside its own room is worse than one that's
 *  slightly off-centre.) */
export function roomLabelPoint(room: DetectedRoom): Point2D {
  const n = room.outline.length;
  const sum = room.outline.reduce((acc, p) => ({ x: acc.x + p.x, y: acc.y + p.y }), { x: 0, y: 0 });
  return { x: sum.x / n, y: sum.y / n };
}

export function formatRoomArea(areaMm2: number): string {
  return `${(areaMm2 / 1_000_000).toFixed(1)} m²`;
}
