// ============================================================================
// Core geometric primitives
// ============================================================================

export interface Point2D {
  x: number;
  y: number;
}

export interface Point3D {
  x: number;
  y: number;
  z: number;
}

export interface DimensionLine {
  start: Point3D;
  end: Point3D;
  label: string;
  value: number; // mm
}

// ============================================================================
// Roof parameter inputs (UI -> Engine)
// ============================================================================

export type RoofType = "gable" | "hip" | "shed";

export interface BaseRoofParams {
  type: RoofType;
  pitch: number; // degrees
  eaveHeight: number; // mm
  overhang: number; // mm
  thickness: number; // mm, sheathing thickness
  rafterSpacing?: number; // mm, on-center spacing, default 600
  rafterSection?: { width: number; height: number }; // mm x mm timber section
  sheathingSheet?: { width: number; height: number }; // mm, default 2440x1220
}

export interface GableRoofParams extends BaseRoofParams {
  type: "gable";
  span: number; // mm, building width
  ridgeLength: number; // mm, building length along ridge
}

export interface HipRoofParams extends BaseRoofParams {
  type: "hip";
  width: number; // mm
  length: number; // mm
}

export interface ShedRoofParams extends BaseRoofParams {
  type: "shed";
  width: number; // mm
  length: number; // mm
}

export type RoofParams = GableRoofParams | HipRoofParams | ShedRoofParams;

// ============================================================================
// Building envelope (walls derived from a roof footprint)
// ============================================================================

export type Elevation = "north" | "south" | "east" | "west";

/**
 * A user-drawn wall in plan view: a straight segment from `start` to `end`
 * (mm, same X/Z-mapped-to-plan-X/Y ground plane every other plan-view type
 * here uses), with its own thickness and height. This is the freeform
 * counterpart to the 4 box walls buildingEnvelope.ts derives from a roof
 * footprint -- both go through wallSegmentToFrame() to become a WallFrame,
 * so nothing downstream (window placement, panel cutting, elevation
 * drawings) needs to know which source a wall came from.
 */
export interface WallSegment {
  id: string;
  start: Point2D;
  end: Point2D;
  thicknessMm: number;
  heightMm: number;
}

/**
 * One wall, expressed as a local 2D coordinate frame embedded in 3D world
 * space: `origin` is the wall's own (u=0, v=0) corner (its `start` point,
 * floor level), `right`/`up`/`out` are unit basis vectors such that a
 * wall-local point (u, v, depth) maps to `origin + right*u + up*v +
 * out*depth`. `right x up = out` by construction for every wall, so
 * geometry authored in local (u, v, depth) space keeps correct
 * winding/normals once transformed -- no per-wall special-casing needed at
 * the call site.
 *
 * `id` is just an identifier windows/doors reference (a roof-box elevation
 * name like "north", or a real walls.id for a freeform wall) -- it carries
 * no geometric meaning itself.
 */
export interface WallFrame {
  id: string;
  width: number; // mm, extent along `right` (the wall's own u-axis)
  height: number; // mm, extent along `up`
  thicknessMm: number; // mm, the wall's real thickness -- used as the window-reveal depth (see assembleBuilding.ts)
  origin: Point3D;
  right: Point3D;
  up: Point3D;
  out: Point3D;
}

/** Where a window sits on its wall, independent of the window's own
 *  fabrication params (WindowParams). Both fields are the resolved mm
 *  values -- null/"auto" handling (centered offset, default sill) happens
 *  before this type is constructed, so downstream engine code never has to
 *  special-case missing values. `elevation` is really "which wall" -- it
 *  holds either a fixed elevation name (roof-box mode) or a real wall id
 *  (freeform mode); see WallFrame.id. */
export interface WindowPlacement {
  id: string;
  elevation: string;
  offsetMm: number; // mm, from the wall's left edge (u=0) to the window's left edge
  sillHeightMm: number; // mm, above the floor/eave line (v=0)
  window: WindowParams;
}

/** Same placement shape as WindowPlacement, for a door instead. sillHeightMm
 *  is carried for symmetry with the shared opening-cutting code in
 *  assembleBuilding.ts, but is always 0 in practice: ParametricDoor's
 *  jambs run the full height to the floor with no bottom rail, so a door
 *  doesn't have a sill to set. */
export interface DoorPlacement {
  id: string;
  elevation: string;
  offsetMm: number;
  sillHeightMm: number;
  door: DoorParams;
}

/** Anything that can be cut into a wall as an opening. The wall-panel
 *  partitioning, overlap detection and elevation-drawing code in
 *  assembleBuilding.ts is written against this union rather than
 *  WindowPlacement alone, so a door on a wall is cut correctly and counts
 *  toward the same overlap checks as a window on that wall. */
export type OpeningPlacement = WindowPlacement | DoorPlacement;

// ============================================================================
// Window parameter inputs
// ============================================================================

export type WindowType = "fixed" | "casement" | "sliding";

export interface WindowParams {
  type: WindowType;
  width: number; // mm, overall outer frame width
  height: number; // mm, overall outer frame height
  frameWidth: number; // mm, visible frame member width (the "sightline")
  frameDepth?: number; // mm, frame member depth/thickness, default 60
  glassThickness: number; // mm
  panels?: number; // number of glass lights divided by vertical mullions, default 1
}

// ============================================================================
// Door parameter inputs
// ============================================================================

export type DoorType = "single" | "double" | "sliding";

export interface DoorParams {
  type: DoorType;
  width: number; // mm, overall opening width (both leaves combined for double)
  height: number; // mm, overall opening height
  frameWidth: number; // mm, visible frame member width
  frameDepth?: number; // mm, frame member depth, default 90
  leafThickness: number; // mm, door slab thickness
}

// ============================================================================
// Engine outputs
// ============================================================================

export interface RoofCalculations {
  [key: string]: number;
}

export interface GeometryResult {
  vertices: number[]; // flat [x,y,z,x,y,z,...]
  indices: number[];
}

export interface StructureMember {
  id: string;
  role:
    | "ridge"
    | "rafter"
    | "hipRafter"
    | "valleyRafter"
    | "jackRafter"
    | "purlin"
    | "eaveBeam"
    | "fascia"
    | "head"
    | "sill"
    | "jamb"
    | "mullion"
    | "astragal"
    | "meetingStile"
    | "track";
  length: number; // mm
  section: { width: number; height: number }; // mm
  quantity: number;
  angleCuts?: { start?: number; end?: number }; // degrees, for miter/bevel cuts at each end
}

export interface StructureResult {
  members: StructureMember[];
}

export interface BOMLineItem {
  material: string;
  description: string;
  unit: "pcs" | "m" | "m2" | "sheet";
  quantity: number;
}

// ============================================================================
// Fabrication layer: the bridge to CNC
// ============================================================================

export type StockType = "sheet" | "linear";

export interface JoineryFeature {
  type: "notch" | "mortise" | "hole" | "birdsmouth";
  at: Point2D; // local part coordinates, mm
  width: number;
  height: number;
  depth?: number;
}

/**
 * A Part is the atomic unit the fabrication layer understands.
 * It is generated directly from parametric data -- never derived by
 * "unfolding" the 3D viewer mesh.
 */
export interface Part {
  id: string;
  sourceComponent: string; // e.g. "rafter", "sheathing-panel", "fascia"
  material: string; // e.g. "45x145 C24 Timber", "18mm Birch Ply"
  stockType: StockType;
  thickness: number; // mm
  /** Nominal 2D outline in local part space, mm. For linear stock this is
   *  effectively a rectangle [length x section-height]. */
  outline: Point2D[];
  holes?: Point2D[][];
  joinery?: JoineryFeature[];
  length?: number; // mm, convenience field for linear stock
  quantity: number;
  allowRotation: boolean; // false when grain/finish direction matters
  grainDirection?: number; // degrees, 0 = along local x-axis
  metadata?: Record<string, unknown>;
}

export interface PartsResult {
  parts: Part[];
}

// ============================================================================
// Cutting-stock optimization (1D, linear members)
// ============================================================================

export interface LinearStockOption {
  length: number; // mm, standard purchasable length
  costPerUnit?: number;
}

export interface LinearCutPlan {
  stockLength: number;
  cuts: { partId: string; length: number }[];
  usedLength: number;
  wasteLength: number;
  utilization: number; // 0-1
  /** Set when this stock length WAS a remnant rather than fresh stock. */
  sourceRemnantId?: string;
  /** Material/thickness this plan was cut for -- set by group-aware callers. */
  material?: string;
  thickness?: number;
}

export interface LinearOptimizationResult {
  plans: LinearCutPlan[];
  totalStockUnits: number;
  totalWasteLength: number;
  overallUtilization: number;
  /** Remnant ids consumed by this run. */
  remnantsConsumed?: string[];
}

// ============================================================================
// Nesting (2D, sheet goods)
// ============================================================================

export interface SheetStockOption {
  width: number; // mm
  height: number; // mm
  costPerUnit?: number;
}

/** A specific, individually-tracked offcut sitting in inventory -- distinct
 *  from SheetStockOption/LinearStockOption which describe purchasable
 *  standard sizes. Consumed at most once. */
export interface RemnantSheet {
  id: string;
  width: number;
  height: number;
  material: string;
  thickness: number;
}

export interface RemnantLinear {
  id: string;
  length: number;
  material: string;
  thickness: number;
}

export interface PlacedPart {
  partId: string;
  x: number;
  y: number;
  rotation: number; // degrees
}

export interface NestingSheetResult {
  sheetIndex: number;
  stock: SheetStockOption;
  placements: PlacedPart[];
  usedArea: number;
  wasteArea: number;
  utilization: number; // 0-1
  /** Rectangular unused regions on this sheet (trailing shelf space + unused
   *  band below the last shelf). Candidates for remnant capture. */
  leftoverRegions?: { x: number; y: number; width: number; height: number }[];
  /** Set when this sheet WAS a remnant rather than a fresh stock sheet. */
  sourceRemnantId?: string;
  /** Material/thickness this sheet was nested for -- set by group-aware
   *  callers (nestPartsByMaterial). Absent when nestParts() is called
   *  directly on a pre-filtered, single-material part list. */
  material?: string;
  thickness?: number;
}

export interface NestingResult {
  sheets: NestingSheetResult[];
  unplacedPartIds: string[];
  overallUtilization: number;
  /** Remnant ids fully or partially consumed by this nesting run. */
  remnantsConsumed?: string[];
}

// ============================================================================
// Kerf / tolerance
// ============================================================================

export type CutSide = "inside" | "outside" | "online";

export interface ToolProfile {
  kerf: number; // mm, cutting tool diameter/width
  minSpacing?: number; // mm, minimum gap enforced during nesting
}
