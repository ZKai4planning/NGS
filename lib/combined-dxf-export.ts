import type { Point2D, Part, NestingSheetResult, ToolProfile } from "@/lib/parametric-engine/types";
import { offsetPartOutline } from "@/lib/parametric-engine/fabrication/kerf";

/**
 * DXF vs DWG: DXF is the right choice here, not a fallback. DWG is
 * Autodesk's closed binary format - writing a valid one requires their
 * proprietary RealDWG/Teigha SDK (licensed, not something a from-scratch
 * generator can emit). DXF is the actual open interchange format every
 * major CAD/CAM tool (AutoCAD, Fusion 360, VCarve, SheetCam, LibreCAD,
 * DraftSight) reads natively - "exporting DXF instead of DWG" isn't a
 * missing feature, it's the standard choice.
 *
 * What WAS missing: a way to see every sheet at once instead of only
 * individual per-sheet downloads. This mirrors the same POLYLINE/VERTEX
 * DXF-R12 approach as lib/parametric-engine/fabrication/dxf-export.ts, but
 * lays every sheet out in a grid with a gap and a text label, so opening
 * the single combined file in any CAD viewer shows the whole job the way
 * nesting software presents an overview, not one sheet at a time.
 */

function polylineEntity(points: Point2D[], layer: string): string {
  const lines: string[] = [];
  lines.push("0", "POLYLINE", "8", layer, "66", "1", "70", "1");
  for (const p of points) {
    lines.push("0", "VERTEX", "8", layer, "10", p.x.toFixed(3), "20", p.y.toFixed(3), "30", "0.0");
  }
  lines.push("0", "SEQEND");
  return lines.join("\n");
}

function textEntity(text: string, x: number, y: number, height: number, layer: string): string {
  return ["0", "TEXT", "8", layer, "10", x.toFixed(3), "20", y.toFixed(3), "30", "0.0", "40", height.toFixed(2), "1", text].join(
    "\n"
  );
}

function rotatePoints(points: Point2D[], degrees: number): Point2D[] {
  if (degrees === 0) return points;
  const rad = (degrees * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return points.map((p) => ({ x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos }));
}

export function exportCombinedNestingToDXF(sheets: NestingSheetResult[], parts: Part[], tool: ToolProfile): string {
  const partById = new Map(parts.map((p) => [p.id, p]));
  const layers = new Set<string>(["SHEET_BOUNDARY", "LABEL"]);
  const entityBlocks: string[] = [];

  const GAP = 200; // mm between sheets in the combined view, purely visual
  const sheetsPerRow = Math.ceil(Math.sqrt(sheets.length || 1));
  let maxRowHeight = 0;
  let cursorX = 0;
  let cursorY = 0;

  sheets.forEach((sheet, i) => {
    if (i > 0 && i % sheetsPerRow === 0) {
      cursorX = 0;
      cursorY += maxRowHeight + GAP;
      maxRowHeight = 0;
    }

    const offsetX = cursorX;
    const offsetY = cursorY;

    for (const placement of sheet.placements) {
      const part = partById.get(placement.partId);
      if (!part) continue;

      const layer = part.sourceComponent.toUpperCase().replace(/[^A-Z0-9]/g, "_");
      layers.add(layer);

      const localOutline = offsetPartOutline(part, tool, "outside");
      const rotated = rotatePoints(localOutline, placement.rotation);
      const positioned = rotated.map((p) => ({ x: p.x + placement.x + offsetX, y: p.y + placement.y + offsetY }));

      entityBlocks.push(polylineEntity(positioned, layer));
    }

    const boundary: Point2D[] = [
      { x: offsetX, y: offsetY },
      { x: offsetX + sheet.stock.width, y: offsetY },
      { x: offsetX + sheet.stock.width, y: offsetY + sheet.stock.height },
      { x: offsetX, y: offsetY + sheet.stock.height },
    ];
    entityBlocks.push(polylineEntity(boundary, "SHEET_BOUNDARY"));
    entityBlocks.push(
      textEntity(
        `Sheet ${sheet.sheetIndex}${sheet.material ? ` — ${sheet.material}` : ""}`,
        offsetX,
        offsetY + sheet.stock.height + 15,
        40,
        "LABEL"
      )
    );

    maxRowHeight = Math.max(maxRowHeight, sheet.stock.height);
    cursorX += sheet.stock.width + GAP;
  });

  const tables = [
    "0",
    "SECTION",
    "2",
    "TABLES",
    "0",
    "TABLE",
    "2",
    "LAYER",
    "70",
    String(layers.size),
    ...[...layers].flatMap((layer) => ["0", "LAYER", "2", layer, "70", "0", "62", "7", "6", "CONTINUOUS"]),
    "0",
    "ENDTAB",
    "0",
    "ENDSEC",
  ].join("\n");

  const sections = [
    ["0", "SECTION", "2", "HEADER", "0", "ENDSEC"].join("\n"),
    tables,
    ["0", "SECTION", "2", "ENTITIES", ...entityBlocks, "0", "ENDSEC"].join("\n"),
    ["0", "EOF"].join("\n"),
  ];

  return sections.join("\n");
}
