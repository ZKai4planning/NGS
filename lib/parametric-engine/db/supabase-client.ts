import type { SupabaseClient } from "@supabase/supabase-js";
import type { RoofParams, Part } from "../types";
import type { ParametricRoof } from "../core/ParametricRoof";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * The engine originally shipped its own getSupabaseServerClient() reading
 * SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY. This app already has a service
 * client (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY) in
 * lib/supabase/server.ts, so this just re-exports that instead of keeping a
 * second, differently-named client around.
 */
export function getSupabaseServerClient(): SupabaseClient {
  return createServiceClient();
}

/**
 * Persists a roof config + its computed parts, keyed against THIS app's
 * `projects` table (org_id / client_id / status), not a separate
 * engine-owned projects table. (project_id, params_hash) uniqueness makes
 * recomputing identical params for the same project a no-op at the DB
 * level, pairing with the Upstash cache which avoids recomputing the
 * engine's math at all on a hit.
 */
export async function saveRoofConfig(
  supabase: SupabaseClient,
  projectId: string,
  params: RoofParams,
  paramsHash: string,
  roof: ParametricRoof
) {
  const { data: config, error: configError } = await supabase
    .from("roof_configs")
    .upsert(
      { project_id: projectId, roof_type: params.type, params, params_hash: paramsHash },
      { onConflict: "project_id,params_hash" }
    )
    .select()
    .single();

  if (configError) throw configError;

  const { parts } = roof.generateParts();

  // Replace parts for this config wholesale -- simpler and safer than diffing.
  const { error: deleteError } = await supabase.from("parts").delete().eq("roof_config_id", config.id);
  if (deleteError) throw deleteError;

  const partRows = parts.map((p) => ({
    roof_config_id: config.id,
    external_id: p.id,
    source_component: p.sourceComponent,
    material: p.material,
    stock_type: p.stockType,
    thickness: p.thickness,
    outline: p.outline,
    joinery: p.joinery ?? null,
    length: p.length ?? null,
    quantity: p.quantity,
    allow_rotation: p.allowRotation,
    grain_direction: p.grainDirection ?? null,
    metadata: p.metadata ?? null,
  }));

  if (partRows.length > 0) {
    const { error: partsError } = await supabase.from("parts").insert(partRows);
    if (partsError) throw partsError;
  }

  // Mark the parent project as having dimensions set, using this app's own
  // status field -- the engine itself has no concept of project status.
  await supabase.from("projects").update({ status: "dimensions_set" }).eq("id", projectId);

  return { roofConfigId: config.id as string, partsInserted: partRows.length };
}

/**
 * Same persistence contract as saveRoofConfig -- upsert a roof_configs row,
 * wholesale-replace its parts -- but for a straight-skeleton roof over a
 * freeform footprint (roof_type = 'polygon'), which has no ParametricRoof
 * instance to call .generateParts() on. Callers (app/api/roofs/generate-polygon)
 * are expected to have already run buildPolygonRoof() + 
 * generateSkeletonRoofFabrication() per enclosed room and merged the parts,
 * since one project can have multiple separate enclosed areas each needing
 * their own roof.
 */
export async function savePolygonRoofConfig(
  supabase: SupabaseClient,
  projectId: string,
  storedParams: Record<string, unknown>,
  paramsHash: string,
  parts: Part[]
) {
  const { data: config, error: configError } = await supabase
    .from("roof_configs")
    .upsert(
      { project_id: projectId, roof_type: "polygon", params: storedParams, params_hash: paramsHash },
      { onConflict: "project_id,params_hash" }
    )
    .select()
    .single();

  if (configError) throw configError;

  const { error: deleteError } = await supabase.from("parts").delete().eq("roof_config_id", config.id);
  if (deleteError) throw deleteError;

  const partRows = parts.map((p) => ({
    roof_config_id: config.id,
    external_id: p.id,
    source_component: p.sourceComponent,
    material: p.material,
    stock_type: p.stockType,
    thickness: p.thickness,
    outline: p.outline,
    joinery: p.joinery ?? null,
    length: p.length ?? null,
    quantity: p.quantity,
    allow_rotation: p.allowRotation,
    grain_direction: p.grainDirection ?? null,
    metadata: p.metadata ?? null,
  }));

  if (partRows.length > 0) {
    const { error: partsError } = await supabase.from("parts").insert(partRows);
    if (partsError) throw partsError;
  }

  await supabase.from("projects").update({ status: "dimensions_set" }).eq("id", projectId);

  return { roofConfigId: config.id as string, partsInserted: partRows.length };
}

export async function saveCuttingJob(
  supabase: SupabaseClient,
  roofConfigId: string,
  jobType: "linear" | "nesting",
  toolProfile: unknown,
  stockOptions: unknown,
  result: unknown,
  overallUtilization: number
) {
  const { data, error } = await supabase
    .from("cutting_jobs")
    .insert({
      roof_config_id: roofConfigId,
      job_type: jobType,
      tool_profile: toolProfile,
      stock_options: stockOptions,
      result,
      overall_utilization: overallUtilization,
      status: "completed",
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}
