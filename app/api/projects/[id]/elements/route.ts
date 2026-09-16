import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

/**
 * Roofs go through /api/roofs/generate against the parametric engine's
 * roof_configs/parts tables, which carry far richer data (structural
 * members, fabrication parts, BOM) than the flat columns here ever could.
 * This route handles the two wall-mounted element types: windows and doors
 * (see supabase/migrations/20260915_add_doors.sql -- ParametricDoor already
 * existed fully built in the engine, this is what lets the app save one
 * against a project).
 *
 * NOTE: this GET/POST pair and the roof-generation logic in
 * app/api/roofs/generate/route.ts were found swapped into each other's
 * files during a merge - each is now back in its correct location. See
 * app/api/projects/[id]/elements/[elementId]/route.ts for DELETE, which
 * was also misplaced (living here without the [elementId] segment it
 * needs, so it could never actually receive that param).
 */
const windowSchema = z.object({
  kind: z.literal("window"),
  frameWidthM: z.number().positive(),
  frameHeightM: z.number().positive(),
  windowStyle: z.enum(["casement", "sliding", "picture", "bay", "awning"]),
  elevation: z.string(),
  label: z.string().optional(),
  // Extra fields the parametric engine needs that older callers may not
  // send yet -- default to typical residential values.
  frameSightlineMm: z.number().positive().default(60),
  glassThicknessMm: z.number().positive().default(4),
  panels: z.number().int().min(1).default(1),
  // Real position on the wall (see supabase/migrations/20260914_add_window_position_fields.sql).
  // Both nullable/omittable: null means "auto" (centered offset / standard
  // sill height), resolved in the UI layer rather than baked in here, since
  // "centered" depends on wall width which this route doesn't know.
  offsetMm: z.number().min(0).nullable().optional(),
  sillHeightMm: z.number().min(0).nullable().optional(),
  // References a real drawn wall (see supabase/migrations/20260914_add_walls_table.sql)
  // instead of the fixed elevation label -- set once a project has freeform
  // walls. `elevation` is still required/sent alongside it purely as a
  // human-readable label (e.g. for the DXF/BOM label fallback), not as the
  // geometric source of truth when wallId is present.
  wallId: z.string().uuid().nullable().optional(),
});

/**
 * Doors reuse frameWidthM/frameHeightM (overall opening size) and
 * frameSightlineMm (visible frame member width) from the window schema's
 * conventions -- same physical concepts, same units. sillHeightMm is
 * deliberately NOT accepted here: ParametricDoor's jambs run the full
 * height to the floor with no bottom rail (see that file's construction
 * convention comment), so a door's sill is always 0, not a per-door choice.
 */
const doorSchema = z.object({
  kind: z.literal("door"),
  frameWidthM: z.number().positive(),
  frameHeightM: z.number().positive(),
  doorType: z.enum(["single", "double", "sliding"]),
  elevation: z.string(),
  label: z.string().optional(),
  frameSightlineMm: z.number().positive().default(45),
  leafThicknessMm: z.number().positive().default(40),
  frameDepthMm: z.number().positive().optional(),
  offsetMm: z.number().min(0).nullable().optional(),
  wallId: z.string().uuid().nullable().optional(),
});

const elementSchema = z.discriminatedUnion("kind", [windowSchema, doorSchema]);

/**
 * GET /api/projects/[id]/elements
 * Lists windows AND doors saved against this project. Roofs are
 * intentionally excluded (see note above) -- callers wanting roof data use
 * /api/projects/[id]/roof-config instead.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("project_elements")
    .select("*")
    .eq("project_id", id)
    .in("kind", ["window", "door"])
    .order("created_at", { ascending: true });

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ elements: data ?? [] });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json();
  const parsed = elementSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const supabase = await createClient();
  const row: Record<string, unknown> =
    parsed.data.kind === "window"
      ? {
          project_id: id,
          kind: "window",
          label: parsed.data.label ?? parsed.data.elevation,
          frame_width_m: parsed.data.frameWidthM,
          frame_height_m: parsed.data.frameHeightM,
          window_style: parsed.data.windowStyle,
          elevation: parsed.data.elevation,
          frame_sightline_mm: parsed.data.frameSightlineMm,
          glass_thickness_mm: parsed.data.glassThicknessMm,
          panels: parsed.data.panels,
          offset_mm: parsed.data.offsetMm ?? null,
          sill_height_mm: parsed.data.sillHeightMm ?? null,
          wall_id: parsed.data.wallId ?? null,
        }
      : {
          project_id: id,
          kind: "door",
          label: parsed.data.label ?? parsed.data.elevation,
          frame_width_m: parsed.data.frameWidthM,
          frame_height_m: parsed.data.frameHeightM,
          door_type: parsed.data.doorType,
          elevation: parsed.data.elevation,
          frame_sightline_mm: parsed.data.frameSightlineMm,
          leaf_thickness_mm: parsed.data.leafThicknessMm,
          frame_depth_mm: parsed.data.frameDepthMm ?? null,
          offset_mm: parsed.data.offsetMm ?? null,
          sill_height_mm: 0, // doors always sit at the floor -- not user-settable, see doorSchema's doc
          wall_id: parsed.data.wallId ?? null,
        };

  const { data, error } = await supabase.from("project_elements").insert(row).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ element: data }, { status: 201 });
}
