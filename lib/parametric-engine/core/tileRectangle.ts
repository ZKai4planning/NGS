import type { Part } from "../types";

/**
 * Splits a rectangular plane (e.g. a roof slope) into sheet-stock-sized
 * rectangular parts, laid out in rows. Edge pieces smaller than a full
 * sheet are still emitted as their own part (trim piece) rather than
 * rounding up, since that trim size feeds directly into nesting later.
 *
 * This runs at generateParts() time, directly from parametric inputs --
 * it does not touch the 3D mesh.
 */
export function tileRectangleIntoSheetParts(opts: {
  idPrefix: string;
  sourceComponent: string;
  material: string;
  thickness: number;
  planeWidth: number; // mm, along rafters (slope direction)
  planeHeight: number; // mm, along ridge
  sheet: { width: number; height: number };
  allowRotation?: boolean;
}): Part[] {
  const { idPrefix, sourceComponent, material, thickness, planeWidth, planeHeight, sheet, allowRotation = true } = opts;

  const parts: Part[] = [];
  let sheetIndex = 0;

  for (let y = 0; y < planeHeight; y += sheet.height) {
    const segH = Math.min(sheet.height, planeHeight - y);
    for (let x = 0; x < planeWidth; x += sheet.width) {
      const segW = Math.min(sheet.width, planeWidth - x);
      sheetIndex += 1;
      parts.push({
        id: `${idPrefix}-${sheetIndex}`,
        sourceComponent,
        material,
        stockType: "sheet",
        thickness,
        outline: [
          { x: 0, y: 0 },
          { x: segW, y: 0 },
          { x: segW, y: segH },
          { x: 0, y: segH },
        ],
        quantity: 1,
        allowRotation,
        metadata: { planeOffsetX: x, planeOffsetY: y },
      });
    }
  }

  return parts;
}
