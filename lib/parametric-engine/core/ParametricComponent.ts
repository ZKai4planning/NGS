import type { GeometryResult, StructureResult, DimensionLine, PartsResult, BOMLineItem } from "../types";

/**
 * Base class every parametric building component extends -- roofs, windows,
 * doors, and anything added later. Three.js / DXF / Supabase never touch
 * this class directly -- they consume its outputs. Keeping this
 * framework-free means the same engine works server-side (API routes), in a
 * worker, or in the browser, and means the fabrication layer (kerf, nesting,
 * cutting-stock, DXF export) works identically regardless of which kind of
 * component produced the Part[] it's given.
 */
export abstract class ParametricComponent<P> {
  constructor(public readonly params: P) {
    this.validate(params);
  }

  /** Sanity checks. Default no-op; subclasses override and should call
   *  `super.validate(params)` first if they want to layer checks. */
  protected validate(_params: P): void {
    // no-op by default
  }

  /** Shared derived values (rise, rafter length, glass opening size, etc). */
  abstract calculate(): Record<string, number>;

  /** 3D mesh data for the Three.js viewer. Visualization only -- never used
   *  as the source of truth for fabrication. */
  abstract generateGeometry(): GeometryResult;

  /** Structural/frame members with lengths and sections, independent of any
   *  3D representation. */
  abstract generateStructure(): StructureResult;

  /** Dimension lines for CAD-style annotations in the viewer. */
  abstract generateDimensions(): DimensionLine[];

  /** Flattened, tagged, fabrication-ready parts. This is what the
   *  fabrication layer consumes. Generated directly from params -- not
   *  derived from generateGeometry(). */
  abstract generateParts(): PartsResult;

  /** Human-readable bill of materials, independent of cut optimization. */
  abstract generateBOM(): BOMLineItem[];

  /** Convenience: everything an API route typically needs in one call. */
  generateAll() {
    return {
      calculations: this.calculate(),
      geometry: this.generateGeometry(),
      structure: this.generateStructure(),
      dimensions: this.generateDimensions(),
      parts: this.generateParts(),
      bom: this.generateBOM(),
    };
  }
}
