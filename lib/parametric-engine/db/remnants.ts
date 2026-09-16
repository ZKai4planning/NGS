import type { SupabaseClient } from "@supabase/supabase-js";
import type { RemnantSheet, RemnantLinear, NestingResult, LinearOptimizationResult } from "../types";

/** Minimum size worth tracking as inventory -- mirrors fabrication/nesting.ts's
 *  MIN_USEFUL_REMNANT_EDGE for sheets; linear equivalent kept here. */
const MIN_USEFUL_LINEAR_REMNANT = 200; // mm

export async function fetchAvailableSheetRemnants(
  supabase: SupabaseClient,
  ownerId: string,
  material: string,
  thickness: number
): Promise<RemnantSheet[]> {
  const { data, error } = await supabase
    .from("remnants")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("stock_type", "sheet")
    .eq("material", material)
    .eq("thickness", thickness)
    .eq("status", "available");

  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, width: r.width, height: r.height, material: r.material, thickness: r.thickness }));
}

export async function fetchAvailableLinearRemnants(
  supabase: SupabaseClient,
  ownerId: string,
  material: string,
  thickness: number
): Promise<RemnantLinear[]> {
  const { data, error } = await supabase
    .from("remnants")
    .select("*")
    .eq("owner_id", ownerId)
    .eq("stock_type", "linear")
    .eq("material", material)
    .eq("thickness", thickness)
    .eq("status", "available");

  if (error) throw error;
  return (data ?? []).map((r: any) => ({ id: r.id, length: r.length, material: r.material, thickness: r.thickness }));
}

/** Marks remnants consumed by a job as used, and records any newly leftover
 *  material from that same job as fresh available remnants -- so this run's
 *  offcuts become the next run's inventory. */
export async function reconcileRemnantsAfterNesting(
  supabase: SupabaseClient,
  ownerId: string,
  cuttingJobId: string,
  material: string,
  thickness: number,
  result: NestingResult
): Promise<void> {
  if (result.remnantsConsumed && result.remnantsConsumed.length > 0) {
    const { error } = await supabase.from("remnants").update({ status: "used" }).in("id", result.remnantsConsumed);
    if (error) throw error;
  }

  const newRemnants = result.sheets.flatMap((sheet) =>
    (sheet.leftoverRegions ?? []).map((region) => ({
      owner_id: ownerId,
      material,
      stock_type: "sheet" as const,
      thickness,
      width: region.width,
      height: region.height,
      source_cutting_job_id: cuttingJobId,
      status: "available" as const,
    }))
  );

  if (newRemnants.length > 0) {
    const { error } = await supabase.from("remnants").insert(newRemnants);
    if (error) throw error;
  }
}

export async function reconcileRemnantsAfterLinearCutting(
  supabase: SupabaseClient,
  ownerId: string,
  cuttingJobId: string,
  material: string,
  thickness: number,
  result: LinearOptimizationResult
): Promise<void> {
  if (result.remnantsConsumed && result.remnantsConsumed.length > 0) {
    const { error } = await supabase.from("remnants").update({ status: "used" }).in("id", result.remnantsConsumed);
    if (error) throw error;
  }

  const newRemnants = result.plans
    .filter((plan) => plan.wasteLength >= MIN_USEFUL_LINEAR_REMNANT)
    .map((plan) => ({
      owner_id: ownerId,
      material,
      stock_type: "linear" as const,
      thickness,
      length: plan.wasteLength,
      source_cutting_job_id: cuttingJobId,
      status: "available" as const,
    }));

  if (newRemnants.length > 0) {
    const { error } = await supabase.from("remnants").insert(newRemnants);
    if (error) throw error;
  }
}
