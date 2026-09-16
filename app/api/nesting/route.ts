import { NextRequest, NextResponse } from "next/server";
import type { Part, SheetStockOption, LinearStockOption, ToolProfile, NestingResult, LinearOptimizationResult } from "@/lib/parametric-engine/types";
import { nestParts } from "@/lib/parametric-engine/fabrication/nesting";
import { optimizeLinearCutting } from "@/lib/parametric-engine/fabrication/cutting-stock";
import { groupPartsByMaterial } from "@/lib/parametric-engine/fabrication/group-parts";
import { getSupabaseServerClient, saveCuttingJob } from "@/lib/parametric-engine/db/supabase-client";
import {
  fetchAvailableSheetRemnants,
  fetchAvailableLinearRemnants,
  reconcileRemnantsAfterNesting,
  reconcileRemnantsAfterLinearCutting,
} from "@/lib/parametric-engine/db/remnants";
import { getApiRateLimiter } from "@/lib/parametric-engine/cache/upstash-client";
import { createClient } from "@/lib/supabase/server";

interface NestingRequestBody {
  roofConfigId: string;
  tool: ToolProfile;
  sheetStock?: SheetStockOption;
  linearStock?: LinearStockOption[];
  useRemnants?: boolean;
}

/**
 * POST /api/nesting
 *
 * Updated to match the latest engine upload: parts are now grouped by
 * (material, thickness) before nesting/cutting, because a project with a
 * roof (plywood sheathing) plus windows (glass) plus doors (slab leaves)
 * would otherwise get nested onto the same virtual sheet across totally
 * different materials -- physically meaningless. Each group gets its own
 * remnant lookup, its own nestParts()/optimizeLinearCutting() run, and its
 * own cutting_jobs row, then results are merged for the client with
 * material/thickness tagged on each sheet/plan so the UI can tell them apart.
 *
 * Same two adaptations as before, layered on top of the grouped logic:
 * ownership resolves via THIS app's `projects.org_id` (not the engine's own
 * `owner_id`), and access is checked explicitly since this route writes via
 * the service client (bypasses RLS).
 */
export async function POST(req: NextRequest) {
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const identifier = req.headers.get("x-forwarded-for") ?? user.id;
  const { success } = await getApiRateLimiter().limit(identifier);
  if (!success) {
    return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
  }

  let body: NestingRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { roofConfigId, tool, sheetStock, linearStock, useRemnants = true } = body;
  if (!roofConfigId || !tool) {
    return NextResponse.json({ error: "roofConfigId and tool are required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();

    const { data: configRow, error: configError } = await supabase
      .from("roof_configs")
      .select("id, project_id, projects(org_id)")
      .eq("id", roofConfigId)
      .single();
    if (configError) throw configError;
    const ownerId: string | undefined = (configRow as any)?.projects?.org_id;

    // Authorization: this lookup ran on the service client (bypasses RLS),
    // so ownership must be enforced here, in code, before touching data.
    const callerOrgId = user.app_metadata?.org_id ?? user.id;
    if (!ownerId || ownerId !== callerOrgId) {
      return NextResponse.json({ error: "Roof config not found" }, { status: 404 });
    }

    const { data: partRows, error } = await supabase.from("parts").select("*").eq("roof_config_id", roofConfigId);
    if (error) throw error;

    const parts: Part[] = (partRows ?? []).map((row: any) => ({
      id: row.external_id,
      sourceComponent: row.source_component,
      material: row.material,
      stockType: row.stock_type,
      thickness: row.thickness,
      outline: row.outline,
      joinery: row.joinery ?? undefined,
      length: row.length ?? undefined,
      quantity: row.quantity,
      allowRotation: row.allow_rotation,
      grainDirection: row.grain_direction ?? undefined,
      metadata: row.metadata ?? undefined,
    }));

    const response: Record<string, unknown> = {};

    // --- Sheet nesting, one run per (material, thickness) group ------------
    if (sheetStock) {
      const groups = groupPartsByMaterial(parts, "sheet");
      const combined: NestingResult = { sheets: [], unplacedPartIds: [], overallUtilization: 0, remnantsConsumed: [] };
      let sheetIndexOffset = 0;

      for (const group of groups) {
        const remnants =
          useRemnants && ownerId ? await fetchAvailableSheetRemnants(supabase, ownerId, group.material, group.thickness) : [];

        const result = nestParts(group.parts, sheetStock, tool, remnants);

        const job = await saveCuttingJob(supabase, roofConfigId, "nesting", tool, sheetStock, result, result.overallUtilization);
        if (ownerId) {
          await reconcileRemnantsAfterNesting(supabase, ownerId, job.id, group.material, group.thickness, result);
        }

        const taggedSheets = result.sheets.map((s) => ({
          ...s,
          sheetIndex: s.sheetIndex + sheetIndexOffset,
          material: group.material,
          thickness: group.thickness,
        }));
        sheetIndexOffset += result.sheets.length;

        combined.sheets.push(...taggedSheets);
        combined.unplacedPartIds.push(...result.unplacedPartIds);
        combined.remnantsConsumed!.push(...(result.remnantsConsumed ?? []));
      }

      const totalUsed = combined.sheets.reduce((s, sh) => s + sh.usedArea, 0);
      const totalArea = combined.sheets.reduce((s, sh) => s + sh.stock.width * sh.stock.height, 0);
      combined.overallUtilization = totalArea > 0 ? totalUsed / totalArea : 0;

      response.nesting = combined;
    }

    // --- Linear cutting-stock, one run per (material, thickness) group -----
    if (linearStock && linearStock.length > 0) {
      const groups = groupPartsByMaterial(parts, "linear");
      const combined: LinearOptimizationResult = { plans: [], totalStockUnits: 0, totalWasteLength: 0, overallUtilization: 0, remnantsConsumed: [] };

      for (const group of groups) {
        const remnants =
          useRemnants && ownerId ? await fetchAvailableLinearRemnants(supabase, ownerId, group.material, group.thickness) : [];

        const result = optimizeLinearCutting(group.parts, linearStock, tool.kerf, remnants);

        const job = await saveCuttingJob(supabase, roofConfigId, "linear", tool, linearStock, result, result.overallUtilization);
        if (ownerId) {
          await reconcileRemnantsAfterLinearCutting(supabase, ownerId, job.id, group.material, group.thickness, result);
        }

        const taggedPlans = result.plans.map((p) => ({ ...p, material: group.material, thickness: group.thickness }));
        combined.plans.push(...taggedPlans);
        combined.totalStockUnits += result.totalStockUnits;
        combined.totalWasteLength += result.totalWasteLength;
        combined.remnantsConsumed!.push(...(result.remnantsConsumed ?? []));
      }

      const totalStock = combined.plans.reduce((s, p) => s + p.stockLength, 0);
      combined.overallUtilization = totalStock > 0 ? (totalStock - combined.totalWasteLength) / totalStock : 0;

      response.linear = combined;
    }

    // Bump project status now that fabrication data has been generated.
    const { data: cfg } = await supabase.from("roof_configs").select("project_id").eq("id", roofConfigId).single();
    if (cfg?.project_id) {
      await supabase.from("projects").update({ status: "exported" }).eq("id", cfg.project_id);
    }

    return NextResponse.json({ roofConfigId, ...response });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
