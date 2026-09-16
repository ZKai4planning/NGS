import { ParametricRoof } from "./ParametricRoof";
import { tileRectangleIntoSheetParts } from "./tileRectangle";
import type {
  GableRoofParams,
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

export class GableRoof extends ParametricRoof<GableRoofParams> {
  protected validate(params: GableRoofParams): void {
    super.validate(params);
    if (params.span <= 0) throw new Error(`Invalid span: ${params.span}`);
    if (params.ridgeLength <= 0) throw new Error(`Invalid ridgeLength: ${params.ridgeLength}`);
  }

  calculate(): RoofCalculations {
    const { span, pitch, overhang } = this.params;
    const pitchRad = degToRad(pitch);
    const halfSpan = span / 2;
    const rise = halfSpan * Math.tan(pitchRad);
    const rafterRunLength = halfSpan / Math.cos(pitchRad);

    const totalSpan = span + overhang * 2;
    const halfTotalSpan = totalSpan / 2;
    const totalRise = halfTotalSpan * Math.tan(pitchRad);
    // Rafter length including overhang, measured along the slope
    const rafterLength = halfTotalSpan / Math.cos(pitchRad);

    return {
      halfSpan,
      rise,
      rafterRunLength,
      totalSpan,
      halfTotalSpan,
      totalRise,
      rafterLength,
      pitchRad,
    };
  }

  generateGeometry(): GeometryResult {
    const { ridgeLength, eaveHeight } = this.params;
    const { halfTotalSpan, totalRise } = this.calculate();

    const x = halfTotalSpan;
    const y = eaveHeight;
    const z = ridgeLength / 2;

    // prettier-ignore
    const vertices = [
      -x, y, -z, // 0 left eave, front
       x, y, -z, // 1 right eave, front
       0, y + totalRise, -z, // 2 ridge, front
      -x, y,  z, // 3 left eave, back
       x, y,  z, // 4 right eave, back
       0, y + totalRise,  z, // 5 ridge, back
    ];

    const indices = [
      0, 1, 2, // front slope (triangulated placeholder; real slopes are quads split at ridge)
      3, 5, 4, // back slope
      0, 2, 5,
      0, 5, 3, // left gable
      1, 4, 5,
      1, 5, 2, // right gable
    ];

    return { vertices, indices };
  }

  generateStructure(): StructureResult {
    const { ridgeLength, rafterSpacing, rafterSection } = this.params;
    const { rafterLength } = this.calculate();

    const spacing = rafterSpacing ?? DEFAULT_RAFTER_SPACING;
    const section = rafterSection ?? DEFAULT_RAFTER_SECTION;

    // Rafters run along both slopes, spaced along the ridge, plus one extra
    // at each gable end.
    const rafterCountPerSlope = Math.ceil(ridgeLength / spacing) + 1;

    const members: StructureMember[] = [
      {
        id: "ridge-beam",
        role: "ridge",
        length: ridgeLength,
        section,
        quantity: 1,
      },
      {
        id: "rafter-common",
        role: "rafter",
        length: rafterLength,
        section,
        quantity: rafterCountPerSlope * 2, // both slopes
        angleCuts: { start: this.params.pitch, end: this.params.pitch },
      },
    ];

    return { members };
  }

  generateDimensions(): DimensionLine[] {
    const { ridgeLength, eaveHeight } = this.params;
    const { halfTotalSpan, totalRise, rafterLength } = this.calculate();

    return [
      {
        start: { x: -halfTotalSpan, y: eaveHeight, z: -ridgeLength / 2 },
        end: { x: halfTotalSpan, y: eaveHeight, z: -ridgeLength / 2 },
        label: "Total Span",
        value: halfTotalSpan * 2,
      },
      {
        start: { x: -halfTotalSpan, y: eaveHeight, z: -ridgeLength / 2 },
        end: { x: 0, y: eaveHeight + totalRise, z: -ridgeLength / 2 },
        label: "Rafter Length",
        value: rafterLength,
      },
      {
        start: { x: 0, y: eaveHeight, z: -ridgeLength / 2 },
        end: { x: 0, y: eaveHeight + totalRise, z: -ridgeLength / 2 },
        label: "Rise",
        value: totalRise,
      },
    ];
  }

  generateParts(): PartsResult {
    const { ridgeLength, thickness, rafterSection, sheathingSheet } = this.params;
    const { rafterLength } = this.calculate();
    const structure = this.generateStructure();
    const section = rafterSection ?? DEFAULT_RAFTER_SECTION;
    const sheet = sheathingSheet ?? DEFAULT_SHEATHING_SHEET;

    const parts: Part[] = [];

    // --- Linear parts: ridge + rafters -------------------------------------
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
        allowRotation: false, // grain runs along length
        metadata: { angleCuts: member.angleCuts },
      });
    }

    // --- Sheet parts: sheathing on both slopes ------------------------------
    const leftSlope = tileRectangleIntoSheetParts({
      idPrefix: "sheathing-left",
      sourceComponent: "sheathing",
      material: `${thickness}mm Sheathing Ply`,
      thickness,
      planeWidth: rafterLength,
      planeHeight: ridgeLength,
      sheet,
    });
    const rightSlope = tileRectangleIntoSheetParts({
      idPrefix: "sheathing-right",
      sourceComponent: "sheathing",
      material: `${thickness}mm Sheathing Ply`,
      thickness,
      planeWidth: rafterLength,
      planeHeight: ridgeLength,
      sheet,
    });

    parts.push(...leftSlope, ...rightSlope);

    return { parts };
  }

  generateBOM(): BOMLineItem[] {
    const { parts } = this.generateParts();
    const linearTotal = parts
      .filter((p) => p.stockType === "linear")
      .reduce((sum, p) => sum + (p.length ?? 0) * p.quantity, 0);
    const sheetCount = parts.filter((p) => p.stockType === "sheet").reduce((s, p) => s + p.quantity, 0);

    return [
      {
        material: "Timber (rafters + ridge)",
        description: "Total linear length required",
        unit: "m",
        quantity: Math.round((linearTotal / 1000) * 100) / 100,
      },
      {
        material: "Sheathing panels",
        description: "Cut panels (pre-nesting count)",
        unit: "pcs",
        quantity: sheetCount,
      },
    ];
  }
}
