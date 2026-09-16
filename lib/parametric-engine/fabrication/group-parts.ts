import type { Part, StockType } from "../types";

export interface MaterialGroup {
  key: string;
  material: string;
  thickness: number;
  parts: Part[];
}

/**
 * Splits parts into groups that share a material AND thickness. This is the
 * fix for the "one dominant material per job" limitation: nesting a sheet
 * of 18mm ply against a sheet of 12mm ply (or two different ply grades) is
 * physically meaningless, so every stock-allocation call -- fresh stock AND
 * remnants -- must run per group, never across groups.
 */
export function groupPartsByMaterial(parts: Part[], stockType: StockType): MaterialGroup[] {
  const groups = new Map<string, MaterialGroup>();

  for (const part of parts) {
    if (part.stockType !== stockType) continue;
    const key = `${part.material}__${part.thickness}`;
    const existing = groups.get(key);
    if (existing) {
      existing.parts.push(part);
    } else {
      groups.set(key, { key, material: part.material, thickness: part.thickness, parts: [part] });
    }
  }

  return [...groups.values()];
}
