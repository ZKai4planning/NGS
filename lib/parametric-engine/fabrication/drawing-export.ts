import type { Point2D } from "../types";

/**
 * Same minimal DXF-R12 writer approach as dxf-export.ts / combined-dxf-export.ts,
 * but for the assembled 2D drawing (an outline + dimension lines that
 * resemble the finished component) rather than a cut-list of individual
 * parts. This is the "does it look like the actual roof/window" export;
 * exportNestedSheetToDXF / exportCombinedNestingToDXF remain the "what do I
 * cut and from which sheet" export -- the two serve different jobs on
 * purpose and both stay available.
 */

export interface DrawingOutlineDXF {
  points: Point2D[];
  layer: string;
  closed?: boolean;
}

export interface DrawingDimDXF {
  start: Point2D;
  end: Point2D;
  label: string;
}

function polylineEntity(points: Point2D[], layer: string, closed: boolean): string {
  const lines: string[] = [];
  lines.push("0", "POLYLINE", "8", layer, "66", "1", "70", closed ? "1" : "0");
  for (const p of points) {
    lines.push("0", "VERTEX", "8", layer, "10", p.x.toFixed(3), "20", p.y.toFixed(3), "30", "0.0");
  }
  lines.push("0", "SEQEND");
  return lines.join("\n");
}

function lineEntity(p1: Point2D, p2: Point2D, layer: string): string {
  return ["0", "LINE", "8", layer, "10", p1.x.toFixed(3), "20", p1.y.toFixed(3), "30", "0.0", "11", p2.x.toFixed(3), "21", p2.y.toFixed(3), "31", "0.0"].join("\n");
}

function textEntity(text: string, x: number, y: number, height: number, layer: string): string {
  return ["0", "TEXT", "8", layer, "10", x.toFixed(3), "20", y.toFixed(3), "30", "0.0", "40", height.toFixed(2), "1", text].join("\n");
}

export function exportAssemblyDrawingToDXF(title: string, outlines: DrawingOutlineDXF[], dims: DrawingDimDXF[]): string {
  const layers = new Set<string>(["DIMENSIONS", "TITLE"]);
  const entityBlocks: string[] = [];

  for (const outline of outlines) {
    layers.add(outline.layer);
    entityBlocks.push(polylineEntity(outline.points, outline.layer, outline.closed !== false));
  }

  const allX = outlines.flatMap((o) => o.points.map((p) => p.x));
  const allY = outlines.flatMap((o) => o.points.map((p) => p.y));
  const minX = allX.length ? Math.min(...allX) : 0;
  const maxY = allY.length ? Math.max(...allY) : 0;

  for (const dim of dims) {
    entityBlocks.push(lineEntity(dim.start, dim.end, "DIMENSIONS"));
    const midX = (dim.start.x + dim.end.x) / 2;
    const midY = (dim.start.y + dim.end.y) / 2;
    const value = Math.round(Math.hypot(dim.end.x - dim.start.x, dim.end.y - dim.start.y));
    entityBlocks.push(textEntity(`${dim.label} - ${value}mm`, midX, midY, 40, "DIMENSIONS"));
  }

  entityBlocks.push(textEntity(title, minX, maxY + 200, 80, "TITLE"));

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
