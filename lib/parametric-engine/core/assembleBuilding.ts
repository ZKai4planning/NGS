import { ParametricWindow } from "./ParametricWindow";
import { ParametricDoor } from "./ParametricDoor";
import { getBuildingWalls } from "./buildingEnvelope";
import type { GeometryResult, Point3D, WallFrame, WindowPlacement, DoorPlacement, OpeningPlacement, RoofParams, DimensionLine } from "../types";

/** True for a DoorPlacement, false for a WindowPlacement -- the one place
 *  that needs to tell the two apart, since everything else (cutting,
 *  overlap checks, elevation outlines) only cares about width/height/offset,
 *  which both share via openingRectFor(). */
function isDoorPlacement(p: OpeningPlacement): p is DoorPlacement {
  return "door" in p;
}

function openingWidth(p: OpeningPlacement): number {
  return isDoorPlacement(p) ? p.door.width : p.window.width;
}

function openingHeight(p: OpeningPlacement): number {
  return isDoorPlacement(p) ? p.door.height : p.window.height;
}

const FALLBACK_WALL_DEPTH = 150; // mm, used only if a wall somehow has no thickness set

/** Maps a wall-local (u, v, depth) point into world space via the wall's
 *  basis vectors (see WallFrame doc in types/index.ts). */
function toWorld(wall: WallFrame, u: number, v: number, depth: number): Point3D {
  return {
    x: wall.origin.x + wall.right.x * u + wall.up.x * v + wall.out.x * depth,
    y: wall.origin.y + wall.right.y * u + wall.up.y * v + wall.out.y * depth,
    z: wall.origin.z + wall.right.z * u + wall.up.z * v + wall.out.z * depth,
  };
}

export interface WindowOverlap {
  aId: string;
  bId: string;
  elevation: string;
}

/**
 * Flags any two windows on the same wall whose openings actually overlap
 * (touching edges don't count -- two windows sharing a mullion line at the
 * same offset is a legitimate design, not a clash). Doesn't fix anything or
 * mutate `placements` -- callers decide whether that's a hard reject or
 * just a warning; see the "Add a window" / "Save position" handlers in
 * app/(dashboard)/projects/[id]/page.tsx, which currently reject.
 */
export function findOverlappingPairs(placements: OpeningPlacement[]): WindowOverlap[] {
  const byElevation = new Map<string, OpeningPlacement[]>();
  for (const p of placements) {
    const list = byElevation.get(p.elevation) ?? [];
    list.push(p);
    byElevation.set(p.elevation, list);
  }

  const overlaps: WindowOverlap[] = [];
  for (const [elevation, group] of byElevation) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = openingRectFor(group[i]);
        const b = openingRectFor(group[j]);
        const overlapsRect = a.left < b.right && b.left < a.right && a.bottom < b.top && b.bottom < a.top;
        if (overlapsRect) {
          overlaps.push({ aId: group[i].id, bId: group[j].id, elevation });
        }
      }
    }
  }
  return overlaps;
}

interface OpeningRect {
  left: number;
  right: number;
  bottom: number;
  top: number;
}

function openingRectFor(placement: OpeningPlacement): OpeningRect {
  return {
    left: placement.offsetMm,
    right: placement.offsetMm + openingWidth(placement),
    bottom: placement.sillHeightMm,
    top: placement.sillHeightMm + openingHeight(placement),
  };
}

/**
 * Partitions a wall rectangle [0,width] x [0,height] into axis-aligned solid
 * quads, skipping any region covered by an opening -- a standard rectilinear
 * decomposition (split into columns at every opening's left/right edge, then
 * each column into bands at the edges of whichever openings span it) that
 * handles any number of non-overlapping openings on the same wall, including
 * several stacked side by side, without needing real polygon boolean ops.
 * Overlapping openings aren't validated here; the API layer is where that
 * should be caught before it ever reaches the engine.
 */
function partitionWallSolidRegions(width: number, height: number, openings: OpeningRect[]): OpeningRect[] {
  const xs = new Set<number>([0, width]);
  for (const o of openings) {
    xs.add(clamp(o.left, 0, width));
    xs.add(clamp(o.right, 0, width));
  }
  const columns = [...xs].sort((a, b) => a - b);

  const solids: OpeningRect[] = [];
  for (let i = 0; i < columns.length - 1; i++) {
    const colLeft = columns[i];
    const colRight = columns[i + 1];
    if (colRight - colLeft <= 0) continue;
    const colMid = (colLeft + colRight) / 2;

    const covering = openings.filter((o) => o.left <= colMid && o.right >= colMid);

    const ys = new Set<number>([0, height]);
    for (const o of covering) {
      ys.add(clamp(o.bottom, 0, height));
      ys.add(clamp(o.top, 0, height));
    }
    const rows = [...ys].sort((a, b) => a - b);

    for (let j = 0; j < rows.length - 1; j++) {
      const rowBottom = rows[j];
      const rowTop = rows[j + 1];
      if (rowTop - rowBottom <= 0) continue;
      const rowMid = (rowBottom + rowTop) / 2;
      const isHole = covering.some((o) => o.bottom <= rowMid && o.top >= rowMid);
      if (!isHole) {
        solids.push({ left: colLeft, right: colRight, bottom: rowBottom, top: rowTop });
      }
    }
  }
  return solids;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

/** Builds the solid part of one wall (window openings cut out) as a flat
 *  panel set back behind the window plane by the wall's own real
 *  thickness -- visualization only (a true reveal would need front AND
 *  back wall faces plus jamb returns, same spirit as createWallWithWindow's
 *  own simplification), but generalized to N openings on one panel instead
 *  of exactly one, and now honoring each wall's actual configured
 *  thickness rather than one hardcoded depth for every wall regardless of
 *  what was drawn in the Wall Studio. */
export function buildWallPanelGeometry(wall: WallFrame, placements: OpeningPlacement[]): GeometryResult {
  const openings = placements.map(openingRectFor);
  const solids = partitionWallSolidRegions(wall.width, wall.height, openings);
  const depth = wall.thicknessMm > 0 ? wall.thicknessMm : FALLBACK_WALL_DEPTH;

  const vertices: number[] = [];
  const indices: number[] = [];

  for (const r of solids) {
    const base = vertices.length / 3;
    const corners = [
      toWorld(wall, r.left, r.bottom, -depth),
      toWorld(wall, r.right, r.bottom, -depth),
      toWorld(wall, r.right, r.top, -depth),
      toWorld(wall, r.left, r.top, -depth),
    ];
    for (const c of corners) vertices.push(c.x, c.y, c.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  return { vertices, indices };
}

/**
 * Transforms one window's own local geometry (ParametricWindow.generateGeometry
 * -- a flat plate centered on its own origin) into world space, centered in
 * its opening on `wall`. Because every WallFrame basis satisfies
 * right x up = out (see buildingEnvelope.ts), this is a pure basis-change: no
 * per-elevation winding fixup needed even for mirrored walls (south/west).
 */
export function placeWindowGeometry(wall: WallFrame, placement: WindowPlacement): GeometryResult {
  const win = new ParametricWindow(placement.window);
  const local = win.generateGeometry();
  const uCenter = placement.offsetMm + placement.window.width / 2;
  const vCenter = placement.sillHeightMm + placement.window.height / 2;

  const vertices: number[] = [];
  for (let i = 0; i < local.vertices.length; i += 3) {
    const lx = local.vertices[i];
    const ly = local.vertices[i + 1];
    const lz = local.vertices[i + 2];
    const p = toWorld(wall, uCenter + lx, vCenter + ly, lz);
    vertices.push(p.x, p.y, p.z);
  }

  return { vertices, indices: [...local.indices] };
}

/**
 * Same idea as placeWindowGeometry, for a door. ParametricDoor's local
 * geometry is NOT vertically centered the way a window's is -- its y runs
 * 0..height, floor to head, since a door has no sill -- so the vertical
 * placement is just `sillHeightMm + ly` with no `+ height/2` term. In
 * practice sillHeightMm is always 0 for doors (see DoorPlacement's doc),
 * so this places the door directly on the floor line, which is the whole
 * point of a door rather than a window.
 */
export function placeDoorGeometry(wall: WallFrame, placement: DoorPlacement): GeometryResult {
  const door = new ParametricDoor(placement.door);
  const local = door.generateGeometry();
  const uCenter = placement.offsetMm + placement.door.width / 2;

  const vertices: number[] = [];
  for (let i = 0; i < local.vertices.length; i += 3) {
    const lx = local.vertices[i];
    const ly = local.vertices[i + 1];
    const lz = local.vertices[i + 2];
    const p = toWorld(wall, uCenter + lx, placement.sillHeightMm + ly, lz);
    vertices.push(p.x, p.y, p.z);
  }

  return { vertices, indices: [...local.indices] };
}

function mergeGeometries(parts: GeometryResult[]): GeometryResult {
  const vertices: number[] = [];
  const indices: number[] = [];
  for (const part of parts) {
    const base = vertices.length / 3;
    vertices.push(...part.vertices);
    for (const idx of part.indices) indices.push(idx + base);
  }
  return { vertices, indices };
}

export interface BuildingScene {
  geometry: GeometryResult;
  dimensions: DimensionLine[];
  walls: WallFrame[];
}

/**
 * General version of assembleBuildingScene: takes any set of WallFrames
 * (roof-box-derived or freeform-drawn -- see wallSegment.ts) plus whatever
 * roof/cap geometry should sit on top (a real pitched roof mesh, a flat
 * placeholder slab from placeholderRoof.ts, or none at all) and merges
 * everything with every window cut into its real wall.
 */
export function assembleWalledScene(
  walls: WallFrame[],
  roofGeometry: GeometryResult | null,
  placements: OpeningPlacement[]
): BuildingScene {
  const parts: GeometryResult[] = roofGeometry ? [roofGeometry] : [];

  for (const wall of walls) {
    const onThisWall = placements.filter((p) => p.elevation === wall.id);
    parts.push(buildWallPanelGeometry(wall, onThisWall));
    for (const placement of onThisWall) {
      parts.push(isDoorPlacement(placement) ? placeDoorGeometry(wall, placement) : placeWindowGeometry(wall, placement));
    }
  }

  const dimensions: DimensionLine[] = walls.flatMap((wall) => {
    const a = toWorld(wall, 0, 0, 0);
    const b = toWorld(wall, wall.width, 0, 0);
    const c = toWorld(wall, 0, wall.height, 0);
    return [
      { start: a, end: b, label: `${wall.id} wall width`, value: wall.width },
      { start: a, end: c, label: `${wall.id} wall height`, value: wall.height },
    ];
  });

  return { geometry: mergeGeometries(parts), dimensions, walls };
}

/**
 * The roof-box-derived building: roof + all 4 walls + every window cut
 * into its real wall at its real position, merged into one scene -- as
 * opposed to the per-window generic swatch (createWallWithWindow) or the
 * roof-only preview, neither of which shows how the building actually goes
 * together. Thin wrapper around assembleWalledScene for the common
 * roof-box case.
 */
export function assembleBuildingScene(
  roofParams: RoofParams,
  roofGeometry: GeometryResult,
  placements: OpeningPlacement[]
): BuildingScene {
  return assembleWalledScene(getBuildingWalls(roofParams), roofGeometry, placements);
}

// ============================================================================
// 2D elevation drawings -- same wall-local (u, v) coordinates as the 3D
// placement above, just without the `depth`/`out` axis, so Cad2DDrawing and
// the DXF exporter can consume them directly.
// ============================================================================

export interface ElevationDrawing {
  wall: WallFrame;
  outline: { x: number; y: number }[];
  windowOutlines: { id: string; kind: "window" | "door"; outline: { x: number; y: number }[] }[];
}

export function getElevationDrawing(wall: WallFrame, placements: OpeningPlacement[]): ElevationDrawing {
  const onThisWall = placements.filter((p) => p.elevation === wall.id);
  return {
    wall,
    outline: [
      { x: 0, y: 0 },
      { x: wall.width, y: 0 },
      { x: wall.width, y: wall.height },
      { x: 0, y: wall.height },
    ],
    windowOutlines: onThisWall.map((p) => {
      const r = openingRectFor(p);
      return {
        id: p.id,
        kind: isDoorPlacement(p) ? "door" : "window",
        outline: [
          { x: r.left, y: r.bottom },
          { x: r.right, y: r.bottom },
          { x: r.right, y: r.top },
          { x: r.left, y: r.top },
        ],
      };
    }),
  };
}
