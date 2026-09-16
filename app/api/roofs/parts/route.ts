import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServerClient } from "@/lib/parametric-engine/db/supabase-client";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/roofs/parts?roofConfigId=...
 * Returns the flattened, fabrication-ready parts for a given roof config,
 * exactly as stored by /api/roofs/generate.
 */
export async function GET(req: NextRequest) {
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const roofConfigId = req.nextUrl.searchParams.get("roofConfigId");
  if (!roofConfigId) {
    return NextResponse.json({ error: "roofConfigId query param is required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServerClient();

    // Same pattern as /api/nesting: this lookup runs on the service client
    // (bypasses RLS), so ownership must be checked here, not left to the DB.
    const { data: configRow, error: configError } = await supabase
      .from("roof_configs")
      .select("id, projects(org_id)")
      .eq("id", roofConfigId)
      .single();
    if (configError || !configRow) {
      return NextResponse.json({ error: "Roof config not found" }, { status: 404 });
    }
    const ownerId = (configRow as any)?.projects?.org_id;
    const callerOrgId = user.app_metadata?.org_id ?? user.id;
    if (ownerId !== callerOrgId) {
      return NextResponse.json({ error: "Roof config not found" }, { status: 404 });
    }

    const { data, error } = await supabase.from("parts").select("*").eq("roof_config_id", roofConfigId);
    if (error) throw error;

    return NextResponse.json({ roofConfigId, parts: data });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
