import { ParametricRoof } from "./ParametricRoof";
import { tileRectangleIntoSheetParts } from "./tileRectangle";
import type {
  HipRoofParams,
  RoofCalculations,
  GeometryResult,
  StructureResult,
  StructureMember,
  DimensionLine,
  PartsResult,
  Part,
  BOMLineItem,
} from "../types";

const degToRad = (deg: number) => (deg * Math.PI) / 180;

const DEFAULT_RAFTER_SPACING = 600; // mm
const DEFAULT_RAFTER_SECTION = { width: 45, height: 145 }; // mm
const DEFAULT_SHEATHING_SHEET = { width: 2440, height: 1220 }; // mm

/**
 * Standard 45-degree hip roof: the hips run diagonally from each corner
 * to the ridge. Assumes length >= width so there is a straight ridge run;
 * for a square footprint the ridge length collapses to 0 (a pyramid hip).
 */
export class HipRoof extends ParametricRoof<HipRoofParams> {
  protected validate(params: HipRoofParams): void {
    super.validate(params);
    if (params.width <= 0) throw new Error(`Invalid width: ${params.width}`);
    if (params.length <= 0) throw new Error(`Invalid length: ${params.length}`);
  }

  calculate(): RoofCalculations {
    const { width, length, pitch, overhang } = this.params;
    const pitchRad = degToRad(pitch);

    const halfWidth = width / 2;
    const rise = halfWidth * Math.tan(pitchRad);

    // Ridge runs along the long axis, set back by halfWidth from each end
    // (45 degree hips).
    const ridgeLength = Math.max(length - width, 0);

    // Common rafter (perpendicular to ridge, mid-span)
    const commonRafterRun = halfWidth + overhang;
    const commonRafterLength = commonRafterRun / Math.cos(pitchRad);

    // Hip rafter: horizontal run is the diagonal of a halfWidth x halfWidth
    // square (45 degree hip), plus overhang along the diagonal.
    const hipRun = Math.sqrt(2) * (halfWidth + overhang);
    // Hip rafters sit at a compound angle; length uses the same rise but the
    // longer diagonal run.
    const hipRafterLength = Math.sqrt(hipRun * hipRun + rise * rise);

    return {
      halfWidth,
      rise,
      ridgeLength,
      commonRafterRun,
      commonRafterLength,
      hipRun,
      hipRafterLength,
      pitchRad,
    };
  }

  generateGeometry(): GeometryResult {
    const { width, length, eaveHeight, overhang } = this.params;
    const { rise, ridgeLength } = this.calculate();

    const halfW = width / 2 + overhang;
    const halfL = length / 2 + overhang;
    const halfRidge = ridgeLength / 2;
    const y = eaveHeight;
    const yTop = eaveHeight + rise;

    // prettier-ignore
    const vertices = [
      -halfW, y, -halfL, // 0 corner
       halfW, y, -halfL, // 1 corner
       halfW, y,  halfL, // 2 corner
      -halfW, y,  halfL, // 3 corner
      -halfRidge, yTop, 0, // 4 ridge end A
       halfRidge, yTop, 0, // 5 ridge end B
    ];

    const indices = [
      0, 1, 5, 0, 5, 4, // front hip plane (two triangles)
      1, 2, 5,          // right hip triangle
      2, 3, 4, 2, 4, 5, // back hip plane
      3, 0, 4,          // left hip triangle
    ];

    return { vertices, indices };
  }

  generateStructure(): StructureResult {
    const { width, rafterSpacing, rafterSection } = this.params;
    const { commonRafterLength, hipRafterLength, ridgeLength } = this.calculate();

    const spacing = rafterSpacing ?? DEFAULT_RAFTER_SPACING;
    const section = rafterSection ?? DEFAULT_RAFTER_SECTION;

    const commonRafterCount = Math.max(Math.ceil(ridgeLength / spacing) * 2, 0);
    // Jack rafters fill the hip triangles at each end, decreasing in length;
    // approximate count from half-width over spacing, both ends, both sides.
    const jackRafterCountPerHipFace = Math.max(Math.floor(width / 2 / spacing), 1);
    const jackRafterCount = jackRafterCountPerHipFace * 4; // 4 hip faces

    const members: StructureMember[] = [
      {
        id: "ridge-beam",
        role: "ridge",
        length: ridgeLength,
        section,
        quantity: ridgeLength > 0 ? 1 : 0,
      },
      {
        id: "hip-rafter",
        role: "hipRafter",
        length: hipRafterLength,
        section,
        quantity: 4,
        angleCuts: { start: 45, end: this.params.pitch },
      },
      {
        id: "common-rafter",
        role: "rafter",
        length: commonRafterLength,
        section,
        quantity: commonRafterCount,
        angleCuts: { start: this.params.pitch, end: this.params.pitch },
      },
      {
        id: "jack-rafter",
        role: "jackRafter",
        // Average length; a production system would emit one member per
        // discrete jack rafter with its exact decreasing length.
        length: commonRafterLength * 0.6,
        section,
        quantity: jackRafterCount,
        angleCuts: { start: 45, end: this.params.pitch },
      },
    ];

    return { members: members.filter((m) => m.quantity > 0) };
  }

  generateDimensions(): DimensionLine[] {
    const { width, length, eaveHeight } = this.params;
    const { rise, ridgeLength, hipRafterLength } = this.calculate();

    return [
      { start: { x: -width / 2, y: eaveHeight, z: 0 }, end: { x: width / 2, y: eaveHeight, z: 0 }, label: "Width", value: width },
      { start: { x: 0, y: eaveHeight, z: -length / 2 }, end: { x: 0, y: eaveHeight, z: length / 2 }, label: "Length", value: length },
      { start: { x: 0, y: eaveHeight, z: 0 }, end: { x: 0, y: eaveHeight + rise, z: 0 }, label: "Rise", value: rise },
      { start: { x: -ridgeLength / 2, y: eaveHeight + rise, z: 0 }, end: { x: ridgeLength / 2, y: eaveHeight + rise, z: 0 }, label: "Ridge Length", value: ridgeLength },
      { start: { x: -width / 2, y: eaveHeight, z: -length / 2 }, end: { x: -ridgeLength / 2, y: eaveHeight + rise, z: 0 }, label: "Hip Rafter", value: hipRafterLength },
    ];
  }

  generateParts(): PartsResult {
    const { width, length, thickness, rafterSection, sheathingSheet } = this.params;
    const structure = this.generateStructure();
    const section = rafterSection ?? DEFAULT_RAFTER_SECTION;
    const sheet = sheathingSheet ?? DEFAULT_SHEATHING_SHEET;

    const parts: Part[] = [];

    for (const member of structure.members) {
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
        allowRotation: false,
        metadata: { angleCuts: member.angleCuts },
      });
    }

    // Approximate each of the 4 hip planes as a triangle-ish rectangle for
    // sheathing tiling purposes (conservative -- slightly over-orders vs.
    // the true triangular hip end, which is fine since offcuts feed the
    // remnant pool downstream).
    const { commonRafterLength } = this.calculate();
    const planes = [
      { w: commonRafterLength, h: length - width }, // two long hip-plane trapezoids
      { w: commonRafterLength, h: width },           // two hip-end triangles (bounded)
    ];

    planes.forEach((plane, i) => {
      if (plane.h <= 0) return;
      const tiled = tileRectangleIntoSheetParts({
        idPrefix: `sheathing-plane${i}`,
        sourceComponent: "sheathing",
        material: `${thickness}mm Sheathing Ply`,
        thickness,
        planeWidth: plane.w,
        planeHeight: plane.h,
        sheet,
      });
      parts.push(...tiled);
    });

    return { parts };
  }

  generateBOM(): BOMLineItem[] {
    const { parts } = this.generateParts();
    const linearTotal = parts
      .filter((p) => p.stockType === "linear")
      .reduce((sum, p) => sum + (p.length ?? 0) * p.quantity, 0);
    const sheetCount = parts.filter((p) => p.stockType === "sheet").reduce((s, p) => s + p.quantity, 0);

    return [
      { material: "Timber (hips, jacks, common, ridge)", description: "Total linear length required", unit: "m", quantity: Math.round((linearTotal / 1000) * 100) / 100 },
      { material: "Sheathing panels", description: "Cut panels (pre-nesting count)", unit: "pcs", quantity: sheetCount },
    ];
  }
}
