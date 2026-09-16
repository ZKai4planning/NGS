import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const patchSchema = z.object({
  startX: z.number().optional(),
  startY: z.number().optional(),
  endX: z.number().optional(),
  endY: z.number().optional(),
  thicknessMm: z.number().positive().optional(),
  heightMm: z.number().positive().optional(),
});

/**
 * PATCH /api/projects/[id]/walls/[wallId]
 * Moves an endpoint, resizes, or re-thicknesses one wall. Dragging a
 * "joined" corner in the studio (see WallStudio2D.tsx) issues one of these
 * per wall that shares that corner -- there's no separate batch-move
 * endpoint; each wall's start/end are independent rows, joined only by
 * having matching coordinates.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; wallId: string }> }
) {
  const { id, wallId } = await params;
  const body = await req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { startX, startY, endX, endY, thicknessMm, heightMm } = parsed.data;
  if ([startX, startY, endX, endY, thicknessMm, heightMm].every((v) => v === undefined)) {
    return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
  }

  const update: Record<string, number> = {};
  if (startX !== undefined) update.start_x_mm = startX;
  if (startY !== undefined) update.start_y_mm = startY;
  if (endX !== undefined) update.end_x_mm = endX;
  if (endY !== undefined) update.end_y_mm = endY;
  if (thicknessMm !== undefined) update.thickness_mm = thicknessMm;
  if (heightMm !== undefined) update.height_mm = heightMm;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("walls")
    .update(update)
    .eq("id", wallId)
    .eq("project_id", id)
    .select()
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: "Wall not found" }, { status: 404 });

  return NextResponse.json({ wall: data });
}

/**
 * DELETE /api/projects/[id]/walls/[wallId]
 * Any window/door on this wall has its wall_id set to null by the FK's
 * ON DELETE SET NULL (see the migration) -- it isn't deleted, but it does
 * lose its placement and needs a new wall assigned in the UI.
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; wallId: string }> }
) {
  const { id, wallId } = await params;
  const supabase = await createClient();

  const { error } = await supabase.from("walls").delete().eq("id", wallId).eq("project_id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
