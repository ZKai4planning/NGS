import type { PolygonRoofResult, RoofFaceLocal, SkeletonArc } from "./straightSkeletonRoof";
import { tileRectangleIntoSheetParts } from "./tileRectangle";
import type { BOMLineItem, Part, Point2D, StructureMember, StructureResult } from "../types";

const DEFAULT_RAFTER_SPACING = 600; // mm
const DEFAULT_RAFTER_SECTION = { width: 45, height: 145 }; // mm
const DEFAULT_SHEATHING_SHEET = { width: 2440, height: 1220 }; // mm
const MIN_RAFTER_RUN_MM = 50; // below this the "rafter" is a sliver at a hip tip, not a real member
const MAX_RAFTERS_PER_FACE = 500; // guard against a pathological footprint generating unbounded parts

export interface SkeletonRoofFabricationOptions {
  pitchDeg: number;
  rafterSpacingMm?: number;
  rafterSection?: { width: number; height: number };
  sheathingThicknessMm?: number;
  sheathingSheet?: { width: number; height: number };
}

export interface SkeletonRoofFabrication {
  structure: StructureResult;
  parts: Part[];
  bom: BOMLineItem[];
  /** Per-face rafter runs, useful for showing a real cutting schedule. */
  rafterSchedule: { lengthMm: number; quantity: number }[];
  totalTimberMm: number;
  sheetCount: number;
  roofSurfaceAreaMm2: number;
}

/**
 * Interpolates a face's upper boundary at position `u` along its eave.
 * The boundary is a chain ascending in u (see RoofFaceLocal), so this is a
 * straight segment lookup -- no general polygon work needed.
 */
function runAtU(face: RoofFaceLocal, u: number): number {
  const chain = face.upper;
  if (chain.length < 2) return 0;
  if (u <= chain[0].u) return chain[0].t;
  if (u >= chain[chain.length - 1].u) return chain[chain.length - 1].t;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    if (u >= a.u && u <= b.u) {
      const span = b.u - a.u;
      if (span <= 1e-9) return Math.max(a.t, b.t);
      const f = (u - a.u) / span;
      return a.t + (b.t - a.t) * f;
    }
  }
  return 0;
}

/** Area of a face in its own (u, t) plan coordinates. */
function facePlanArea(face: RoofFaceLocal): number {
  // Polygon = eave line (t=0) plus the upper chain; integrate the chain.
  let area = 0;
  for (let i = 0; i < face.upper.length - 1; i++) {
    const a = face.upper[i];
    const b = face.upper[i + 1];
    area += ((a.t + b.t) / 2) * (b.u - a.u);
  }
  return Math.abs(area);
}

function pointInPolygon(pt: Point2D, poly: Point2D[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > pt.y !== b.y > pt.y && pt.x < ((b.x - a.x) * (pt.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * Produces a real cutting schedule for a straight-skeleton roof: ridge
 * beams, hip and valley rafters taken directly from the skeleton arcs, and
 * common/jack rafters generated per face at the given spacing.
 *
 * This is what the rectangular roof engine (GableRoof.generateParts) does
 * for a box, generalized to a roof whose faces are arbitrary polygons.
 * Two things follow from that generalization and are worth knowing:
 *
 *  - Rafters on a hipped face are JACK rafters: each one is shorter than
 *    the last, so the schedule legitimately contains many distinct lengths
 *    rather than one repeated length. They're grouped by length so the
 *    schedule stays readable.
 *  - Sheathing is tiled over each face's bounding rectangle in slope
 *    space, keeping only tiles that actually overlap the face. Sheets on a
 *    sloping edge still need trimming to the face outline on site -- the
 *    count is honest, but it is a cut-sheet count, not a nested layout.
 */
export function generateSkeletonRoofFabrication(
  roof: PolygonRoofResult,
  options: SkeletonRoofFabricationOptions
): SkeletonRoofFabrication {
  const pitchRad = (options.pitchDeg * Math.PI) / 180;
  const cosPitch = Math.cos(pitchRad);
  const spacing = options.rafterSpacingMm ?? DEFAULT_RAFTER_SPACING;
  const section = options.rafterSection ?? DEFAULT_RAFTER_SECTION;
  const sheet = options.sheathingSheet ?? DEFAULT_SHEATHING_SHEET;
  const sheathingThickness = options.sheathingThicknessMm ?? 18;

  const members: StructureMember[] = [];
  const parts: Part[] = [];

  // --- Ridge / hip / valley members come straight off the skeleton arcs.
  // Their true (sloping) length is already computed by the skeleton, so
  // these need no re-derivation.
  const arcLength3D = (arc: SkeletonArc) => {
    const plan = Math.hypot(arc.b.x - arc.a.x, arc.b.y - arc.a.y);
    const rise = Math.abs(arc.b.t - arc.a.t) * Math.tan(pitchRad);
    return Math.hypot(plan, rise);
  };

  const arcGroups: { kind: SkeletonArc["kind"]; role: StructureMember["role"]; label: string }[] = [
    { kind: "ridge", role: "ridge", label: "ridge" },
    { kind: "hip", role: "hipRafter", label: "hip-rafter" },
    { kind: "valley", role: "valleyRafter", label: "valley-rafter" },
  ];

  for (const group of arcGroups) {
    const arcs = roof.arcs.filter((a) => a.kind === group.kind);
    const byLength = new Map<number, number>();
    for (const arc of arcs) {
      const l = Math.round(arcLength3D(arc));
      if (l < MIN_RAFTER_RUN_MM) continue;
      byLength.set(l, (byLength.get(l) ?? 0) + 1);
    }
    let i = 0;
    for (const [lengthMm, quantity] of [...byLength.entries()].sort((a, b) => b[0] - a[0])) {
      i += 1;
      members.push({
        id: `${group.label}-${i}`,
        role: group.role,
        length: lengthMm,
        section,
        quantity,
        // A hip or valley meets the plane at the pitch angle at both ends.
        angleCuts: group.kind === "ridge" ? undefined : { start: options.pitchDeg, end: options.pitchDeg },
      });
    }
  }

  // --- Common / jack rafters, generated per face.
  const rafterLengths = new Map<number, number>();
  for (const face of roof.faces) {
    if (face.edgeLengthMm <= 0) continue;
    const count = Math.min(MAX_RAFTERS_PER_FACE, Math.floor(face.edgeLengthMm / spacing) + 1);
    for (let k = 0; k <= count; k++) {
      const u = Math.min(face.edgeLengthMm, k * spacing);
      const run = runAtU(face, u);
      if (run < MIN_RAFTER_RUN_MM) continue;
      const slopeLength = Math.round(run / cosPitch);
      rafterLengths.set(slopeLength, (rafterLengths.get(slopeLength) ?? 0) + 1);
      if (u >= face.edgeLengthMm) break;
    }
  }

  const rafterSchedule = [...rafterLengths.entries()]
    .map(([lengthMm, quantity]) => ({ lengthMm, quantity }))
    .sort((a, b) => b.lengthMm - a.lengthMm);

  rafterSchedule.forEach((entry, idx) => {
    members.push({
      id: `rafter-${idx + 1}`,
      role: "rafter",
      length: entry.lengthMm,
      section,
      quantity: entry.quantity,
      angleCuts: { start: options.pitchDeg, end: options.pitchDeg },
    });
  });

  // --- Linear cut parts, in the same shape the nesting/export layer
  // already consumes from the rectangular engine.
  for (const member of members) {
    parts.push({
      id: member.id,
      sourceComponent: member.role,
      material: `${section.width}x${section.height} Timber`,
      stockType: "linear",
      thickness: section.height,
      length: member.length,
      outline: [
        { x: 0, y: 0 },
        { x: member.length, y: 0 },
        { x: member.length, y: section.width },
        { x: 0, y: section.width },
      ],
      quantity: member.quantity,
      allowRotation: false, // grain runs along length
      metadata: { angleCuts: member.angleCuts },
    });
  }

  // --- Sheathing per face, in slope space (u along the eave, s up the slope).
  let roofSurfaceAreaMm2 = 0;
  for (const face of roof.faces) {
    const slopePoly: Point2D[] = [
      { x: 0, y: 0 },
      { x: face.edgeLengthMm, y: 0 },
      ...[...face.upper].reverse().map((p) => ({ x: p.u, y: p.t / cosPitch })),
    ];
    const faceArea = facePlanArea(face) / cosPitch;
    roofSurfaceAreaMm2 += faceArea;
    if (faceArea <= 0) continue;

    const maxS = Math.max(...face.upper.map((p) => p.t / cosPitch));
    if (maxS <= 0) continue;

    const candidates = tileRectangleIntoSheetParts({
      idPrefix: `sheathing-face${face.edgeIndex}`,
      sourceComponent: "sheathing",
      material: `${sheathingThickness}mm Sheathing Ply`,
      thickness: sheathingThickness,
      planeWidth: face.edgeLengthMm,
      planeHeight: maxS,
      sheet,
    });

    // Keep only tiles that actually overlap the face -- a hipped (triangular)
    // face otherwise gets billed for sheets over empty space.
    for (const tile of candidates) {
      const offX = (tile.metadata?.planeOffsetX as number) ?? 0;
      const offY = (tile.metadata?.planeOffsetY as number) ?? 0;
      const w = Math.max(...tile.outline.map((p) => p.x));
      const h = Math.max(...tile.outline.map((p) => p.y));
      const samples: Point2D[] = [
        { x: offX + w / 2, y: offY + h / 2 },
        { x: offX + 1, y: offY + 1 },
        { x: offX + w - 1, y: offY + 1 },
        { x: offX + 1, y: offY + h - 1 },
        { x: offX + w - 1, y: offY + h - 1 },
      ];
      if (samples.some((pt) => pointInPolygon(pt, slopePoly))) {
        parts.push({ ...tile, metadata: { ...tile.metadata, faceEdgeIndex: face.edgeIndex } });
      }
    }
  }

  const totalTimberMm = members.reduce((sum, m) => sum + m.length * m.quantity, 0);
  const sheetCount = parts.filter((p) => p.stockType === "sheet").reduce((s, p) => s + p.quantity, 0);

  const bom: BOMLineItem[] = [
    {
      material: "Timber (rafters + hips/valleys + ridge)",
      description: "Total linear length required",
      unit: "m",
      quantity: Math.round((totalTimberMm / 1000) * 100) / 100,
    },
    {
      material: "Sheathing panels",
      description: "Cut panels (pre-nesting count)",
      unit: "pcs",
      quantity: sheetCount,
    },
    {
      material: "Roof surface",
      description: "Total sloped area across all faces",
      unit: "m2",
      quantity: Math.round((roofSurfaceAreaMm2 / 1_000_000) * 100) / 100,
    },
  ];

  return {
    structure: { members },
    parts,
    bom,
    rafterSchedule,
    totalTimberMm,
    sheetCount,
    roofSurfaceAreaMm2,
  };
}
