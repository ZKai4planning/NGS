import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const positionSchema = z.object({
  // Both nullable: null resets the field back to "auto" (centered offset /
  // standard sill height) rather than requiring the caller to know the
  // current auto-resolved value. Elevation itself isn't editable here --
  // moving a window to a different wall is a bigger change (its offset
  // stops meaning anything) than this PATCH is meant to handle.
  offsetMm: z.number().min(0).nullable().optional(),
  sillHeightMm: z.number().min(0).nullable().optional(),
  wallId: z.string().uuid().nullable().optional(),
});

/**
 * PATCH /api/projects/[id]/elements/[elementId]
 * Updates a saved window's real position on its wall (see
 * supabase/migrations/20260914_add_window_position_fields.sql). Only the
 * fields present in the body are touched.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; elementId: string }> }
) {
  const { id, elementId } = await params;
  const body = await req.json();
  const parsed = positionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.offsetMm === undefined && parsed.data.sillHeightMm === undefined && parsed.data.wallId === undefined) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const update: Record<string, number | string | null> = {};
  if (parsed.data.offsetMm !== undefined) update.offset_mm = parsed.data.offsetMm;
  if (parsed.data.sillHeightMm !== undefined) update.sill_height_mm = parsed.data.sillHeightMm;
  if (parsed.data.wallId !== undefined) update.wall_id = parsed.data.wallId;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("project_elements")
    .update(update)
    .eq("id", elementId)
    .eq("project_id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Element not found" }, { status: 404 });

  return NextResponse.json({ element: data });
}

/**
 * DELETE /api/projects/[id]/elements/[elementId]
 * Removes a single saved window from a project. Scoped by both project_id
 * and id so a stray/guessed elementId can't delete a row on a project the
 * caller doesn't actually have open (RLS on project_elements enforces org
 * ownership on top of this).
 *
 * This was previously placed at .../elements/route.ts (no [elementId]
 * segment in the path), so the handler's own elementId param could never
 * actually be populated by Next.js - moved here where the route segment
 * genuinely exists.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; elementId: string }> }
) {
  const { id, elementId } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_elements")
    .delete()
    .eq("id", elementId)
    .eq("project_id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Element not found" }, { status: 404 });

  return NextResponse.json({ deleted: true, id: elementId });
}
