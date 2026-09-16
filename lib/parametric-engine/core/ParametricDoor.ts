import { ParametricComponent } from "./ParametricComponent";
import type {
  DoorParams,
  GeometryResult,
  StructureResult,
  StructureMember,
  DimensionLine,
  PartsResult,
  Part,
  BOMLineItem,
} from "../types";

const DEFAULT_FRAME_DEPTH = 90; // mm

/**
 * Construction convention: head runs the full outer width; jambs run the
 * FULL height to the floor (no sill/bottom rail -- doors don't have one).
 * Double doors get a center astragal the leaves meet against; sliding doors
 * get a head track instead of a swing-door astragal.
 */
export class ParametricDoor extends ParametricComponent<DoorParams> {
  protected validate(params: DoorParams): void {
    if (params.width <= 0) throw new Error(`Invalid width: ${params.width}`);
    if (params.height <= 0) throw new Error(`Invalid height: ${params.height}`);
    if (params.frameWidth <= 0) throw new Error(`Invalid frameWidth: ${params.frameWidth}`);
    if (params.leafThickness <= 0) throw new Error(`Invalid leafThickness: ${params.leafThickness}`);
    if (params.frameWidth * 2 >= params.width) throw new Error("frameWidth too large for given width");
  }

  calculate(): Record<string, number> {
    const { width, height, frameWidth, type } = this.params;
    const frameDepth = this.params.frameDepth ?? DEFAULT_FRAME_DEPTH;

    const openingWidth = width - 2 * frameWidth;
    const leafCount = type === "double" ? 2 : 1;
    const astragalWidth = type === "double" ? frameWidth / 2 : 0;
    const leafWidth = type === "double" ? (openingWidth - astragalWidth) / 2 : openingWidth;
    // Head consumes frameWidth off the top; jambs run full height to the
    // floor, so the leaf height is reduced only by the head + a nominal
    // 10mm clearance gap at the floor/threshold.
    const leafHeight = height - frameWidth - 10;

    return { frameDepth, openingWidth, leafCount, leafWidth, leafHeight, headLength: width, jambLength: height, astragalWidth };
  }

  generateGeometry(): GeometryResult {
    const { width, height } = this.params;
    const { openingWidth, leafHeight } = this.calculate();
    const halfW = width / 2;

    // Flat elevation: outer frame outline (3-sided, open at the bottom) +
    // the leaf area as a filled plane. Visual only.
    // prettier-ignore
    const vertices = [
      -halfW, 0, 0,  halfW, 0, 0,  halfW, height, 0,  -halfW, height, 0, // 0-3 outer (bottom open)
      -openingWidth / 2, 0, 0,  openingWidth / 2, 0, 0,  openingWidth / 2, leafHeight, 0,  -openingWidth / 2, leafHeight, 0, // 4-7 leaf area
    ];

    const indices = [4, 5, 6, 4, 6, 7];

    return { vertices, indices };
  }

  generateStructure(): StructureResult {
    const { width, height, frameWidth, type } = this.params;
    const frameDepth = this.params.frameDepth ?? DEFAULT_FRAME_DEPTH;
    const { astragalWidth } = this.calculate();
    const section = { width: frameWidth, height: frameDepth };

    const members: StructureMember[] = [
      { id: "head", role: "head", length: width, section, quantity: 1 },
      { id: "jamb", role: "jamb", length: height, section, quantity: 2 },
    ];

    if (type === "double") {
      members.push({ id: "astragal", role: "astragal", length: height, section: { width: astragalWidth, height: frameDepth }, quantity: 1 });
    }
    if (type === "sliding") {
      members.push({ id: "track", role: "track", length: width, section: { width: frameWidth, height: 30 }, quantity: 1 });
    }

    return { members };
  }

  generateDimensions(): DimensionLine[] {
    const { width, height } = this.params;
    const { openingWidth, leafHeight } = this.calculate();

    return [
      { start: { x: -width / 2, y: 0, z: 0 }, end: { x: width / 2, y: 0, z: 0 }, label: "Overall Width", value: width },
      { start: { x: -width / 2, y: 0, z: 0 }, end: { x: -width / 2, y: height, z: 0 }, label: "Overall Height", value: height },
      { start: { x: -openingWidth / 2, y: 0, z: 0 }, end: { x: openingWidth / 2, y: 0, z: 0 }, label: "Opening Width", value: openingWidth },
      { start: { x: -openingWidth / 2, y: 0, z: 0 }, end: { x: -openingWidth / 2, y: leafHeight, z: 0 }, label: "Leaf Height", value: leafHeight },
    ];
  }

  generateParts(): PartsResult {
    const { frameWidth, leafThickness } = this.params;
    const frameDepth = this.params.frameDepth ?? DEFAULT_FRAME_DEPTH;
    const structure = this.generateStructure();
    const { leafCount, leafWidth, leafHeight } = this.calculate();

    const parts: Part[] = [];

    for (const member of structure.members) {
      parts.push({
        id: member.id,
        sourceComponent: member.role,
        material: `${frameWidth}x${frameDepth} Door Frame`,
        stockType: "linear",
        thickness: frameDepth,
        length: member.length,
        outline: [
          { x: 0, y: 0 },
          { x: member.length, y: 0 },
          { x: member.length, y: member.section.width },
          { x: 0, y: member.section.width },
        ],
        quantity: member.quantity,
        allowRotation: false,
      });
    }

    // Door leaf/leaves -- sheet-type parts (a slab door is, mechanically, a
    // large flat panel) so they flow through the same nesting/DXF pipeline
    // as sheathing, even though in practice a door slab is usually bought
    // pre-made rather than cut from stock. Kept as sheet parts because a
    // shop building custom flush doors from ply blanks genuinely does nest
    // and cut them this way.
    //
    // NOTE: a full-height leaf (commonly ~2000mm+) will not fit a standard
    // 2440x1220 sheet in a fixed (non-rotated) orientation, and allowRotation
    // is deliberately false here since door faces usually have a grain/veneer
    // direction that matters. nestParts() will correctly report this leaf as
    // unplaced against standard sheet stock -- that's accurate, not a bug:
    // it reflects that full-size door blanks are typically ordered as
    // pre-sized stock (or an oversized "door blank" sheet), not nested from
    // 2440x1220 sheathing-style stock. Pass a taller SheetStockOption for
    // door jobs if you do source full-size blanks.
    parts.push({
      id: "door-leaf",
      sourceComponent: "leaf",
      material: `${leafThickness}mm Door Slab`,
      stockType: "sheet",
      thickness: leafThickness,
      outline: [
        { x: 0, y: 0 },
        { x: leafWidth, y: 0 },
        { x: leafWidth, y: leafHeight },
        { x: 0, y: leafHeight },
      ],
      quantity: leafCount,
      allowRotation: false,
    });

    return { parts };
  }

  generateBOM(): BOMLineItem[] {
    const { parts } = this.generateParts();
    const linearTotal = parts.filter((p) => p.stockType === "linear").reduce((s, p) => s + (p.length ?? 0) * p.quantity, 0);
    const leafPart = parts.find((p) => p.sourceComponent === "leaf");

    return [
      { material: "Frame timber", description: "Total linear length required", unit: "m", quantity: Math.round((linearTotal / 1000) * 100) / 100 },
      { material: "Door leaf", description: "Leaf/leaves", unit: "pcs", quantity: leafPart?.quantity ?? 0 },
    ];
  }
}
