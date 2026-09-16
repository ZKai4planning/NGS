import { ParametricComponent } from "./ParametricComponent";
import type {
  WindowParams,
  GeometryResult,
  StructureResult,
  StructureMember,
  DimensionLine,
  PartsResult,
  Part,
  BOMLineItem,
} from "../types";

const DEFAULT_FRAME_DEPTH = 60; // mm

/**
 * One class handles fixed/casement/sliding rather than three near-identical
 * subclasses (unlike the roof types, which genuinely diverge in geometry
 * math). Sliding windows differ only by adding a meeting stile + track --
 * everything else is param-driven. Split into subclasses later if a type
 * needs materially different geometry.
 *
 * Construction convention (stated explicitly since it drives every length
 * below): head and sill run the FULL outer width; jambs and mullions fit
 * BETWEEN head and sill. This is one valid convention among several used in
 * real joinery -- swap the math here if your shop's convention differs, the
 * rest of the pipeline (fabrication, nesting, DXF) doesn't care either way.
 */
export class ParametricWindow extends ParametricComponent<WindowParams> {
  protected validate(params: WindowParams): void {
    if (params.width <= 0) throw new Error(`Invalid width: ${params.width}`);
    if (params.height <= 0) throw new Error(`Invalid height: ${params.height}`);
    if (params.frameWidth <= 0) throw new Error(`Invalid frameWidth: ${params.frameWidth}`);
    if (params.glassThickness <= 0) throw new Error(`Invalid glassThickness: ${params.glassThickness}`);
    const panels = params.panels ?? 1;
    if (panels < 1) throw new Error(`Invalid panels: ${panels}. Must be >= 1.`);
    if (params.frameWidth * 2 >= params.width) throw new Error("frameWidth too large for given width");
    if (params.frameWidth * 2 >= params.height) throw new Error("frameWidth too large for given height");
  }

  calculate(): Record<string, number> {
    const { width, height, frameWidth } = this.params;
    const panels = this.params.panels ?? 1;
    const frameDepth = this.params.frameDepth ?? DEFAULT_FRAME_DEPTH;

    const mullionCount = Math.max(panels - 1, 0);
    const openingWidth = width - 2 * frameWidth;
    const openingHeight = height - 2 * frameWidth;
    const glassOpeningWidth = openingWidth - mullionCount * frameWidth;
    const glassPanelWidth = glassOpeningWidth / panels;

    return {
      frameDepth,
      openingWidth,
      openingHeight,
      mullionCount,
      glassPanelWidth,
      glassPanelHeight: openingHeight,
      headLength: width,
      sillLength: width,
      jambLength: openingHeight,
      mullionLength: openingHeight,
    };
  }

  generateGeometry(): GeometryResult {
    // Simplified flat elevation: outer frame ring (z=0) + a single recessed
    // glass plane (z=-frameDepth/2) representing the overall glazed area.
    // Visual only -- generateParts() computes the real per-panel/mullion
    // fabrication geometry independently.
    const { width, height } = this.params;
    const { frameDepth, openingWidth, openingHeight } = this.calculate();
    const halfW = width / 2;
    const halfH = height / 2;
    const innerHalfW = openingWidth / 2;
    const innerHalfH = openingHeight / 2;
    const glassZ = -frameDepth / 2;

    // prettier-ignore
    const vertices = [
      -halfW, -halfH, 0, halfW, -halfH, 0, halfW, halfH, 0, -halfW, halfH, 0, // 0-3 outer
      -innerHalfW, -innerHalfH, 0, innerHalfW, -innerHalfH, 0, innerHalfW, innerHalfH, 0, -innerHalfW, innerHalfH, 0, // 4-7 inner (frame face)
      -innerHalfW, -innerHalfH, glassZ, innerHalfW, -innerHalfH, glassZ, innerHalfW, innerHalfH, glassZ, -innerHalfW, innerHalfH, glassZ, // 8-11 glass
    ];

    const indices = [
      0, 1, 5, 0, 5, 4, // bottom frame band
      1, 2, 6, 1, 6, 5, // right frame band
      2, 3, 7, 2, 7, 6, // top frame band
      3, 0, 4, 3, 4, 7, // left frame band
      8, 9, 10, 8, 10, 11, // glass pane
    ];

    return { vertices, indices };
  }

  generateStructure(): StructureResult {
    const { width, frameWidth, type } = this.params;
    const frameDepth = this.params.frameDepth ?? DEFAULT_FRAME_DEPTH;
    const { openingHeight, mullionCount, mullionLength } = this.calculate();
    const section = { width: frameWidth, height: frameDepth };

    const members: StructureMember[] = [
      { id: "head", role: "head", length: width, section, quantity: 1 },
      { id: "sill", role: "sill", length: width, section, quantity: 1 },
      { id: "jamb", role: "jamb", length: openingHeight, section, quantity: 2 },
    ];

    if (mullionCount > 0) {
      members.push({ id: "mullion", role: "mullion", length: mullionLength, section, quantity: mullionCount });
    }

    if (type === "sliding") {
      members.push(
        { id: "meeting-stile", role: "meetingStile", length: openingHeight, section, quantity: 1 },
        { id: "track", role: "track", length: width, section: { width: frameWidth, height: 20 }, quantity: 1 }
      );
    }

    return { members };
  }

  generateDimensions(): DimensionLine[] {
    const { width, height } = this.params;
    const { openingWidth, openingHeight } = this.calculate();

    return [
      { start: { x: -width / 2, y: -height / 2, z: 0 }, end: { x: width / 2, y: -height / 2, z: 0 }, label: "Overall Width", value: width },
      { start: { x: -width / 2, y: -height / 2, z: 0 }, end: { x: -width / 2, y: height / 2, z: 0 }, label: "Overall Height", value: height },
      { start: { x: -openingWidth / 2, y: 0, z: 0 }, end: { x: openingWidth / 2, y: 0, z: 0 }, label: "Glass Opening Width", value: openingWidth },
      { start: { x: 0, y: -openingHeight / 2, z: 0 }, end: { x: 0, y: openingHeight / 2, z: 0 }, label: "Glass Opening Height", value: openingHeight },
    ];
  }

  generateParts(): PartsResult {
    const { frameWidth, glassThickness } = this.params;
    const panels = this.params.panels ?? 1;
    const frameDepth = this.params.frameDepth ?? DEFAULT_FRAME_DEPTH;
    const structure = this.generateStructure();
    const { glassPanelWidth, glassPanelHeight } = this.calculate();

    const parts: Part[] = [];

    for (const member of structure.members) {
      parts.push({
        id: member.id,
        sourceComponent: member.role,
        material: `${frameWidth}x${frameDepth} Window Frame`,
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

    // Glass panes. Modeled as sheet-type Parts so they flow through the same
    // fabrication layer as sheathing -- in practice a glazier usually cuts
    // these to exact size rather than nesting from standard plywood-style
    // sheet stock, so treat this group's "nesting" output as a cut list
    // (one pane per "sheet") rather than a real multi-pane layout; the data
    // model doesn't need to change to represent that.
    parts.push({
      id: "glass-pane",
      sourceComponent: "glazing",
      material: `${glassThickness}mm Glass`,
      stockType: "sheet",
      thickness: glassThickness,
      outline: [
        { x: 0, y: 0 },
        { x: glassPanelWidth, y: 0 },
        { x: glassPanelWidth, y: glassPanelHeight },
        { x: 0, y: glassPanelHeight },
      ],
      quantity: panels,
      allowRotation: false,
    });

    return { parts };
  }

  generateBOM(): BOMLineItem[] {
    const { parts } = this.generateParts();
    const linearTotal = parts.filter((p) => p.stockType === "linear").reduce((s, p) => s + (p.length ?? 0) * p.quantity, 0);
    const glassPart = parts.find((p) => p.sourceComponent === "glazing");
    const glassArea = glassPart
      ? ((glassPart.outline[2].x - glassPart.outline[0].x) * (glassPart.outline[2].y - glassPart.outline[0].y) * glassPart.quantity) / 1e6
      : 0;

    return [
      { material: "Frame timber", description: "Total linear length required", unit: "m", quantity: Math.round((linearTotal / 1000) * 100) / 100 },
      { material: "Glass", description: `${glassPart?.quantity ?? 0} pane(s)`, unit: "m2", quantity: Math.round(glassArea * 100) / 100 },
    ];
  }
}
