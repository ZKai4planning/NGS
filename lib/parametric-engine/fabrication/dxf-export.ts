import type { Point2D, Part, NestingSheetResult, ToolProfile } from "../types";
import { offsetPartOutline } from "./kerf";

/**
 * Minimal, dependency-free DXF R12 writer. R12 is the most universally
 * compatible DXF version across CNC routers, plasma tables, and CAM
 * software (VCarve, Fusion360, SheetCam, etc). Only emits LWPOLYLINE-style
 * closed 2D polylines via the classic POLYLINE/VERTEX/SEQEND entities,
 * which is all a flattened Part outline needs.
 *
 * For anything beyond flat outlines (layers per material, text labels,
 * blocks/inserts for repeated parts) consider swapping to the `dxf-writer`
 * npm package, which this file's API mirrors closely on purpose.
 */

function polylineEntity(points: Point2D[], layer: string): string {
  const lines: string[] = [];
  lines.push("0", "POLYLINE", "8", layer, "66", "1", "70", "1"); // 70=1 -> closed polyline
  for (const p of points) {
    lines.push("0", "VERTEX", "8", layer, "10", p.x.toFixed(3), "20", p.y.toFixed(3), "30", "0.0");
  }
  lines.push("0", "SEQEND");
  return lines.join("\n");
}

function header(): string {
  return ["0", "SECTION", "2", "HEADER", "0", "ENDSEC"].join("\n");
}

function tablesSection(layers: string[]): string {
  const lines: string[] = ["0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", String(layers.length)];
  for (const layer of layers) {
    lines.push("0", "LAYER", "2", layer, "70", "0", "62", "7", "6", "CONTINUOUS");
  }
  lines.push("0", "ENDTAB", "0", "ENDSEC");
  return lines.join("\n");
}

/**
 * Exports a single part's toolpath outline (kerf-compensated) as a standalone
 * DXF, in the part's own local coordinate space -- useful for one-off jobs
 * or verifying a single component before nesting.
 */
export function exportPartToDXF(part: Part, tool: ToolProfile, side: "inside" | "outside" | "online" = "outside"): string {
  const outline = offsetPartOutline(part, tool, side);
  const layer = part.sourceComponent.toUpperCase().replace(/[^A-Z0-9]/g, "_");

  const sections = [
    header(),
    tablesSection([layer]),
    ["0", "SECTION", "2", "ENTITIES", polylineEntity(outline, layer), "0", "ENDSEC"].join("\n"),
    ["0", "EOF"].join("\n"),
  ];

  return sections.join("\n");
}

/**
 * Exports a full nested sheet layout as one DXF -- every placed part at its
 * nested x/y/rotation, in sheet coordinates. This is the file a CNC operator
 * actually loads for a production run.
 */
export function exportNestedSheetToDXF(sheet: NestingSheetResult, parts: Part[], tool: ToolProfile): string {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const layers = new Set<string>();
  const entityBlocks: string[] = [];

  for (const placement of sheet.placements) {
    const part = partById.get(placement.partId);
    if (!part) continue;

    const layer = part.sourceComponent.toUpperCase().replace(/[^A-Z0-9]/g, "_");
    layers.add(layer);

    const localOutline = offsetPartOutline(part, tool, "outside");
    const rotated = rotatePoints(localOutline, placement.rotation);
    const positioned = rotated.map((p) => ({ x: p.x + placement.x, y: p.y + placement.y }));

    entityBlocks.push(polylineEntity(positioned, layer));
  }

  // Sheet boundary on its own layer for operator reference.
  layers.add("SHEET_BOUNDARY");
  const boundary: Point2D[] = [
    { x: 0, y: 0 },
    { x: sheet.stock.width, y: 0 },
    { x: sheet.stock.width, y: sheet.stock.height },
    { x: 0, y: sheet.stock.height },
  ];
  entityBlocks.push(polylineEntity(boundary, "SHEET_BOUNDARY"));

  const sections = [
    header(),
    tablesSection([...layers]),
    ["0", "SECTION", "2", "ENTITIES", ...entityBlocks, "0", "ENDSEC"].join("\n"),
    ["0", "EOF"].join("\n"),
  ];

  return sections.join("\n");
}

function rotatePoints(points: Point2D[], degrees: number): Point2D[] {
  if (degrees === 0) return points;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}
