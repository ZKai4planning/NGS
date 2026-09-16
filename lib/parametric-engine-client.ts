import type {
  RoofParams,
  RoofCalculations,
  GeometryResult,
  StructureResult,
  DimensionLine,
  BOMLineItem,
  SheetStockOption,
  LinearStockOption,
  ToolProfile,
  LinearOptimizationResult,
  NestingResult,
} from "@/lib/parametric-engine/types";

export interface GenerateRoofResponse {
  cached: boolean;
  paramsHash: string;
  roofConfigId: string;
  partsInserted: number;
  calculations: RoofCalculations;
  geometry: GeometryResult;
  structure: StructureResult;
  dimensions: DimensionLine[];
  parts: { parts: unknown[] };
  bom: BOMLineItem[];
}

export async function generateRoof(projectId: string, params: RoofParams): Promise<GenerateRoofResponse> {
  const res = await fetch("/api/roofs/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, params }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `generateRoof failed: ${res.status}`);
  }
  return res.json();
}

export interface GeneratePolygonRoofResponse {
  cached: boolean;
  paramsHash: string;
  roofConfigId: string;
  partsInserted: number;
  roomCount: number;
  ridgeLengthMm: number;
  hipLengthMm: number;
  valleyLengthMm: number;
  roofSurfaceAreaMm2: number;
  bom: BOMLineItem[];
  warnings: string[];
}

/**
 * The wall-geometry counterpart to generateRoof() -- for a freeform plan
 * (Wall Studio), sends the actual drawn walls to
 * /api/roofs/generate-polygon instead of a rectangular RoofParams object.
 * Returns a roofConfigId that plugs into runNesting() exactly like the
 * rectangular flow's does, since parts live in the same table either way.
 */
export async function generatePolygonRoof(
  projectId: string,
  walls: { id: string; start: { x: number; y: number }; end: { x: number; y: number }; thicknessMm: number; heightMm: number }[],
  options: { pitchDeg: number; overhangMm: number; thicknessMm: number }
): Promise<GeneratePolygonRoofResponse> {
  const res = await fetch("/api/roofs/generate-polygon", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectId, walls, ...options }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `generatePolygonRoof failed: ${res.status}`);
  }
  return res.json();
}

export interface RunNestingResponse {
  roofConfigId: string;
  nesting?: NestingResult;
  linear?: LinearOptimizationResult;
}

export async function runNesting(
  roofConfigId: string,
  tool: ToolProfile,
  sheetStock?: SheetStockOption,
  linearStock?: LinearStockOption[]
): Promise<RunNestingResponse> {
  const res = await fetch("/api/nesting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ roofConfigId, tool, sheetStock, linearStock }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error ?? `runNesting failed: ${res.status}`);
  }
  return res.json();
}
