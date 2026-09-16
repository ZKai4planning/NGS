import type { Part, SheetStockOption, NestingResult, NestingSheetResult, PlacedPart, ToolProfile, RemnantSheet } from "../types";

interface BBox {
  width: number;
  height: number;
}

interface Item {
  partId: string;
  width: number;
  height: number;
  allowRotation: boolean;
}

interface StockSlot {
  width: number;
  height: number;
  remnantId?: string;
}

function boundingBox(part: Part): BBox {
  const xs = part.outline.map((p) => p.x);
  const ys = part.outline.map((p) => p.y);
  return { width: Math.max(...xs) - Math.min(...xs), height: Math.max(...ys) - Math.min(...ys) };
}

/**
 * Shelf (guillotine-row) nesting: a solid, fast MVP for rectangular parts
 * (which is everything this engine currently emits). NOT true nesting for
 * irregular/rotated-arbitrary shapes -- swap for a no-fit-polygon nester
 * (SVGnest/Deepnest) when non-rectangular parts show up; keep the function
 * signature identical so callers don't change.
 *
 * Packs one stock slot (remnant or fresh sheet) with as many of the
 * remaining items as fit, shelf by shelf, and reports which rectangular
 * regions were left unused -- those regions are what a caller can offer
 * back to the remnant pool afterward.
 */
function packIntoSlot(items: Item[], slot: StockSlot, spacing: number): { placements: PlacedPart[]; remainingItems: Item[]; leftoverRegions: { x: number; y: number; width: number; height: number }[] } {
  const placements: PlacedPart[] = [];
  const remainingItems: Item[] = [];
  const shelves: { y: number; height: number; cursorX: number }[] = [];

  const queue = [...items];
  for (const item of queue) {
    let placed = false;

    for (const shelf of shelves) {
      const fitsNormal = item.height <= shelf.height && shelf.cursorX + item.width <= slot.width;
      const fitsRotated = item.allowRotation && item.width <= shelf.height && shelf.cursorX + item.height <= slot.width;

      if (fitsNormal) {
        placements.push({ partId: item.partId, x: shelf.cursorX, y: shelf.y, rotation: 0 });
        shelf.cursorX += item.width + spacing;
        placed = true;
        break;
      }
      if (fitsRotated) {
        placements.push({ partId: item.partId, x: shelf.cursorX, y: shelf.y, rotation: 90 });
        shelf.cursorX += item.height + spacing;
        placed = true;
        break;
      }
    }

    if (!placed) {
      const usedHeight = shelves.reduce((s, sh) => s + sh.height + spacing, 0);
      if (item.height <= slot.height - usedHeight && item.width <= slot.width) {
        shelves.push({ y: usedHeight, height: item.height, cursorX: 0 });
        const shelf = shelves[shelves.length - 1];
        placements.push({ partId: item.partId, x: 0, y: shelf.y, rotation: 0 });
        shelf.cursorX = item.width + spacing;
        placed = true;
      }
    }

    if (!placed) remainingItems.push(item);
  }

  // Leftover regions: trailing strip on each shelf + the unused band below
  // the last shelf. Simple, conservative (rectangular) capture -- good
  // enough to seed the remnant pool without needing true polygon subtraction.
  const leftoverRegions: { x: number; y: number; width: number; height: number }[] = [];
  for (const shelf of shelves) {
    const trailingWidth = slot.width - shelf.cursorX;
    if (trailingWidth > 0) {
      leftoverRegions.push({ x: shelf.cursorX, y: shelf.y, width: trailingWidth, height: shelf.height });
    }
  }
  const usedHeight = shelves.reduce((s, sh) => s + sh.height + spacing, 0);
  const bottomBand = slot.height - usedHeight;
  if (bottomBand > 0) {
    leftoverRegions.push({ x: 0, y: usedHeight, width: slot.width, height: bottomBand });
  }

  return { placements, remainingItems, leftoverRegions };
}

const MIN_USEFUL_REMNANT_EDGE = 200; // mm; smaller strips aren't worth tracking as inventory

function isUsefulRegion(region: { width: number; height: number }): boolean {
  return region.width >= MIN_USEFUL_REMNANT_EDGE && region.height >= MIN_USEFUL_REMNANT_EDGE;
}

/**
 * Nests sheet parts against a remnant inventory first, then fresh stock.
 * Remnants are tried smallest-area-first so the smallest sufficient offcut
 * gets consumed, preserving larger remnants for jobs that actually need
 * them. Falls back to an unlimited supply of `freshStock` once remnants
 * are exhausted.
 */
export function nestParts(
  parts: Part[],
  freshStock: SheetStockOption,
  tool: ToolProfile,
  remnants: RemnantSheet[] = []
): NestingResult {
  const sheetParts = parts.filter((p) => p.stockType === "sheet");
  const spacing = tool.minSpacing ?? tool.kerf;

  let items: Item[] = [];
  for (const part of sheetParts) {
    const bbox = boundingBox(part);
    for (let i = 0; i < part.quantity; i++) {
      items.push({ partId: part.id, width: bbox.width, height: bbox.height, allowRotation: part.allowRotation });
    }
  }
  items.sort((a, b) => b.width * b.height - a.width * a.height);

  const remnantQueue = [...remnants].sort((a, b) => a.width * a.height - b.width * b.height);
  const consumedRemnantIds = new Set<string>();
  const sheets: NestingSheetResult[] = [];
  let sheetIndex = 0;

  // Only attempt a remnant/sheet if at least the largest remaining item
  // could conceivably fit -- otherwise skip straight past small remnants.
  function largestItemFits(slot: StockSlot): boolean {
    if (items.length === 0) return false;
    const biggest = items[0];
    const fitsNormal = biggest.width <= slot.width && biggest.height <= slot.height;
    const fitsRotated = biggest.allowRotation && biggest.height <= slot.width && biggest.width <= slot.height;
    return fitsNormal || fitsRotated;
  }

  function runSlot(slot: StockSlot) {
    sheetIndex += 1;
    const { placements, remainingItems, leftoverRegions } = packIntoSlot(items, slot, spacing);
    items = remainingItems;

    if (placements.length === 0) {
      sheetIndex -= 1; // nothing placed, don't count this as a used sheet
      return;
    }

    const usedArea = placements.reduce((sum, pl) => {
      const item = sheetParts
        .flatMap((p) => Array(p.quantity).fill({ id: p.id, bbox: boundingBox(p) }))
        .find((i) => i.id === pl.partId)!;
      const w = pl.rotation === 90 ? item.bbox.height : item.bbox.width;
      const h = pl.rotation === 90 ? item.bbox.width : item.bbox.height;
      return sum + w * h;
    }, 0);

    const totalArea = slot.width * slot.height;
    sheets.push({
      sheetIndex,
      stock: { width: slot.width, height: slot.height },
      placements,
      usedArea,
      wasteArea: totalArea - usedArea,
      utilization: usedArea / totalArea,
      leftoverRegions: leftoverRegions.filter(isUsefulRegion),
      sourceRemnantId: slot.remnantId,
    });

    if (slot.remnantId) consumedRemnantIds.add(slot.remnantId);
  }

  // 1. Draw down remnant inventory first.
  for (const remnant of remnantQueue) {
    if (items.length === 0) break;
    if (!largestItemFits({ width: remnant.width, height: remnant.height })) continue;
    runSlot({ width: remnant.width, height: remnant.height, remnantId: remnant.id });
  }

  // 2. Fresh stock for whatever's left. First separate out anything that
  //    can never fit fresh stock in either orientation -- those go straight
  //    to unplaced rather than blocking placeable items behind them.
  const freshSlot: StockSlot = { width: freshStock.width, height: freshStock.height };
  const permanentlyUnplaced: Item[] = [];
  items = items.filter((item) => {
    const fitsNormal = item.width <= freshSlot.width && item.height <= freshSlot.height;
    const fitsRotated = item.allowRotation && item.height <= freshSlot.width && item.width <= freshSlot.height;
    if (!fitsNormal && !fitsRotated) {
      permanentlyUnplaced.push(item);
      return false;
    }
    return true;
  });

  let guard = 0;
  while (items.length > 0 && guard < 10000) {
    guard += 1;
    const before = items.length;
    runSlot(freshSlot);
    if (items.length === before) break; // safety: nothing placed, avoid infinite loop
  }

  const unplacedPartIds = [...items, ...permanentlyUnplaced].map((i) => i.partId);

  const totalUsed = sheets.reduce((s, sh) => s + sh.usedArea, 0);
  const totalSheetArea = sheets.reduce((s, sh) => s + sh.stock.width * sh.stock.height, 0);

  return {
    sheets,
    unplacedPartIds,
    overallUtilization: totalSheetArea > 0 ? totalUsed / totalSheetArea : 0,
    remnantsConsumed: [...consumedRemnantIds],
  };
}
