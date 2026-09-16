import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

/**
 * GET /api/projects/[id]/roof-config
 * Returns the most recently generated roof config for a project, or null
 * if none exists yet (a brand-new project correctly has no saved config -
 * that's the one case where showing defaults is accurate, not misleading).
 *
 * Uses the RLS-governed client, not the service client -- roof_configs
 * already has a policy scoping reads to the caller's own org (see
 * supabase/schema-parametric-engine.sql), so ownership is enforced by the
 * database here rather than needing a manual check in this route.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("roof_configs")
    .select("id, roof_type, params, created_at")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ roofConfig: data ?? null });
}
