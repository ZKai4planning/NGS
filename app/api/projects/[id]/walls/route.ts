import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * A freeform wall: a straight segment drawn in plan view (see
 * supabase/migrations/20260914_add_walls_table.sql and
 * lib/parametric-engine/core/wallSegment.ts). Zero-length walls are
 * rejected at the DB level too (walls_nonzero_length constraint) -- the
 * check here just gives a clean 400 instead of a raw Postgres error.
 */
const wallSchema = z.object({
  startX: z.number(),
  startY: z.number(),
  endX: z.number(),
  endY: z.number(),
  thicknessMm: z.number().positive().default(150),
  heightMm: z.number().positive().default(2400),
});

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("walls")
    .select("*")
    .eq("project_id", id)
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ walls: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = wallSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.startX === parsed.data.endX && parsed.data.startY === parsed.data.endY) {
    return NextResponse.json({ error: "Wall must have nonzero length" }, { status: 400 });
  }

  const supabase = await createClient();
  const row = {
    project_id: id,
    start_x_mm: parsed.data.startX,
    start_y_mm: parsed.data.startY,
    end_x_mm: parsed.data.endX,
    end_y_mm: parsed.data.endY,
    thickness_mm: parsed.data.thicknessMm,
    height_mm: parsed.data.heightMm,
  };

  const { data, error } = await supabase.from("walls").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ wall: data }, { status: 201 });
}
