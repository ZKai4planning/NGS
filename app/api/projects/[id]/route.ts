import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  status: z.enum([
    "draft",
    "dimensions_set",
    "in_review",
    "approved",
    "exported",
    "submitted_for_council",
    "council_approved",
    "council_rejected",
    "scheduled",
  ]),
});

/**
 * GET /api/projects/[id]
 * Returns the project row itself -- job_type, status, client link, etc.
 * Previously missing entirely, which meant the workspace page had no way
 * to know whether a project was 'roof', 'window', or 'roof_and_window' and
 * always rendered the roof-only UI regardless of what was actually booked.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase.from("projects").select("*").eq("id", id).maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json({ project: data });
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const parsed = patchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .update({ status: parsed.data.status })
    .eq("id", id)
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ project: data });
}

/**
 * DELETE /api/projects/[id]
 * Relies on the ON DELETE CASCADE chain already in the schema:
 * projects -> project_elements, projects -> roof_configs -> parts ->
 * cutting_jobs. One delete here removes every downstream row, including
 * anything the parametric engine generated. Ownership is enforced by RLS
 * (this uses the authed client, not the service client), so a delete call
 * for a project you don't own simply matches zero rows rather than erroring.
 */
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase.from("projects").delete().eq("id", id).select().maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Project not found" }, { status: 404 });

  return NextResponse.json({ deleted: true, id });
}

