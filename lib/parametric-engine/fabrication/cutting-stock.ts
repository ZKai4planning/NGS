import type { Part, LinearStockOption, LinearCutPlan, LinearOptimizationResult, RemnantLinear } from "../types";

interface Piece {
  partId: string;
  length: number;
}

interface StockCandidate {
  length: number;
  remnantId?: string; // present if this candidate is a specific remnant
}

/**
 * First-Fit-Decreasing bin packing for 1D stock, optionally checking a
 * remnant inventory before allocating fresh stock. Each remnant is a
 * specific, individually-tracked piece and is consumed at most once.
 *
 * Remnants are preferred over fresh stock even when a remnant produces
 * marginally more waste than an equivalent fresh length would -- the whole
 * point of remnant reuse is to draw down existing inventory rather than let
 * it accumulate unused, so "smallest sufficient remnant first" beats
 * "smallest sufficient stock of any kind first".
 */
export function optimizeLinearCutting(
  parts: Part[],
  stockOptions: LinearStockOption[],
  kerf: number,
  remnants: RemnantLinear[] = []
): LinearOptimizationResult {
  const linearParts = parts.filter((p) => p.stockType === "linear" && p.length);
  if (linearParts.length === 0) {
    return { plans: [], totalStockUnits: 0, totalWasteLength: 0, overallUtilization: 0, remnantsConsumed: [] };
  }
  if (stockOptions.length === 0) {
    throw new Error("optimizeLinearCutting: at least one stock length option is required");
  }

  const pieces: Piece[] = [];
  for (const part of linearParts) {
    for (let i = 0; i < part.quantity; i++) {
      pieces.push({ partId: part.id, length: part.length! });
    }
  }
  pieces.sort((a, b) => b.length - a.length);

  const sortedFreshStock = [...stockOptions].sort((a, b) => a.length - b.length);
  const longestPiece = pieces[0].length;

  // Remnants sorted smallest-first so the smallest sufficient one gets used,
  // preserving larger remnants for parts that actually need them.
  const availableRemnants = [...remnants].sort((a, b) => a.length - b.length);
  const usableFreshStock = sortedFreshStock.filter((s) => s.length >= longestPiece);

  if (usableFreshStock.length === 0 && !availableRemnants.some((r) => r.length >= longestPiece)) {
    throw new Error(
      `optimizeLinearCutting: no stock or remnant is long enough for the longest part (${longestPiece}mm).`
    );
  }

  const bins: { candidate: StockCandidate; cuts: Piece[]; remaining: number }[] = [];
  const consumedRemnantIds = new Set<string>();
  const remnantPool = [...availableRemnants]; // spliced as consumed

  function openNewBin(piece: Piece): { candidate: StockCandidate; cuts: Piece[]; remaining: number } {
    // Prefer the smallest sufficient, not-yet-consumed remnant.
    const remnantIdx = remnantPool.findIndex((r) => r.length >= piece.length);
    if (remnantIdx !== -1) {
      const remnant = remnantPool.splice(remnantIdx, 1)[0];
      consumedRemnantIds.add(remnant.id);
      return {
        candidate: { length: remnant.length, remnantId: remnant.id },
        cuts: [piece],
        remaining: remnant.length - piece.length,
      };
    }

    const stock = usableFreshStock.find((s) => s.length >= piece.length) ?? usableFreshStock[usableFreshStock.length - 1];
    if (!stock) {
      throw new Error(`optimizeLinearCutting: no fresh stock or remnant available for a ${piece.length}mm part.`);
    }
    return { candidate: { length: stock.length }, cuts: [piece], remaining: stock.length - piece.length };
  }

  for (const piece of pieces) {
    let placed = false;
    for (const bin of bins) {
      const needed = piece.length + (bin.cuts.length > 0 ? kerf : 0);
      if (bin.remaining >= needed) {
        bin.cuts.push(piece);
        bin.remaining -= needed;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push(openNewBin(piece));
    }
  }

  const plans: LinearCutPlan[] = bins.map((bin) => {
    const usedLength = bin.candidate.length - bin.remaining;
    return {
      stockLength: bin.candidate.length,
      cuts: bin.cuts.map((c) => ({ partId: c.partId, length: c.length })),
      usedLength,
      wasteLength: bin.remaining,
      utilization: usedLength / bin.candidate.length,
      sourceRemnantId: bin.candidate.remnantId,
    };
  });

  const totalStock = plans.reduce((s, p) => s + p.stockLength, 0);
  const totalWaste = plans.reduce((s, p) => s + p.wasteLength, 0);

  return {
    plans,
    totalStockUnits: plans.length,
    totalWasteLength: totalWaste,
    overallUtilization: totalStock > 0 ? (totalStock - totalWaste) / totalStock : 0,
    remnantsConsumed: [...consumedRemnantIds],
  };
}
