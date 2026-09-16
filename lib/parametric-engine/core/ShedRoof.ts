import { ParametricRoof } from "./ParametricRoof";
import { tileRectangleIntoSheetParts } from "./tileRectangle";
import type {
  ShedRoofParams,
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

export class ShedRoof extends ParametricRoof<ShedRoofParams> {
  protected validate(params: ShedRoofParams): void {
    super.validate(params);
    if (params.width <= 0) throw new Error(`Invalid width: ${params.width}`);
    if (params.length <= 0) throw new Error(`Invalid length: ${params.length}`);
  }

  calculate(): RoofCalculations {
    const { width, pitch, overhang } = this.params;
    const pitchRad = degToRad(pitch);
    const run = width + overhang; // overhang only on the low + high side, simplified to one side
    const rise = run * Math.tan(pitchRad);
    const rafterLength = run / Math.cos(pitchRad);

    return { run, rise, rafterLength, pitchRad };
  }

  generateGeometry(): GeometryResult {
    const { length, eaveHeight } = this.params;
    const { run, rise } = this.calculate();
    const halfL = length / 2;
    const yLow = eaveHeight;
    const yHigh = eaveHeight + rise;

    // prettier-ignore
    const vertices = [
      0,   yLow,  -halfL, // 0 low edge front
      run, yHigh, -halfL, // 1 high edge front
      run, yHigh,  halfL, // 2 high edge back
      0,   yLow,   halfL, // 3 low edge back
    ];

    const indices = [0, 1, 2, 0, 2, 3];

    return { vertices, indices };
  }

  generateStructure(): StructureResult {
    const { length, rafterSpacing, rafterSection } = this.params;
    const { rafterLength } = this.calculate();

    const spacing = rafterSpacing ?? DEFAULT_RAFTER_SPACING;
    const section = rafterSection ?? DEFAULT_RAFTER_SECTION;
    const rafterCount = Math.ceil(length / spacing) + 1;

    const members: StructureMember[] = [
      {
        id: "rafter-common",
        role: "rafter",
        length: rafterLength,
        section,
        quantity: rafterCount,
        angleCuts: { start: this.params.pitch, end: this.params.pitch },
      },
    ];

    return { members };
  }

  generateDimensions(): DimensionLine[] {
    const { length, eaveHeight } = this.params;
    const { run, rise, rafterLength } = this.calculate();

    return [
      { start: { x: 0, y: eaveHeight, z: -length / 2 }, end: { x: run, y: eaveHeight, z: -length / 2 }, label: "Run", value: run },
      { start: { x: 0, y: eaveHeight, z: -length / 2 }, end: { x: 0, y: eaveHeight + rise, z: -length / 2 }, label: "Rise", value: rise },
      { start: { x: 0, y: eaveHeight, z: -length / 2 }, end: { x: run, y: eaveHeight + rise, z: -length / 2 }, label: "Rafter Length", value: rafterLength },
    ];
  }

  generateParts(): PartsResult {
    const { length, thickness, rafterSection, sheathingSheet } = this.params;
    const { rafterLength } = this.calculate();
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

    const sheathing = tileRectangleIntoSheetParts({
      idPrefix: "sheathing",
      sourceComponent: "sheathing",
      material: `${thickness}mm Sheathing Ply`,
      thickness,
      planeWidth: rafterLength,
      planeHeight: length,
      sheet,
    });
    parts.push(...sheathing);

    return { parts };
  }

  generateBOM(): BOMLineItem[] {
    const { parts } = this.generateParts();
    const linearTotal = parts
      .filter((p) => p.stockType === "linear")
      .reduce((sum, p) => sum + (p.length ?? 0) * p.quantity, 0);
    const sheetCount = parts.filter((p) => p.stockType === "sheet").reduce((s, p) => s + p.quantity, 0);

    return [
      { material: "Timber (rafters)", description: "Total linear length required", unit: "m", quantity: Math.round((linearTotal / 1000) * 100) / 100 },
      { material: "Sheathing panels", description: "Cut panels (pre-nesting count)", unit: "pcs", quantity: sheetCount },
    ];
  }
}