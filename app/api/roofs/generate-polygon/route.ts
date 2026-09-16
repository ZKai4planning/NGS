import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import { detectRooms } from "@/lib/parametric-engine/core/detectRooms";
import { buildPolygonRoof } from "@/lib/parametric-engine/core/straightSkeletonRoof";
import { generateSkeletonRoofFabrication } from "@/lib/parametric-engine/core/skeletonRoofFabrication";
import type { WallSegment, Part, BOMLineItem } from "@/lib/parametric-engine/types";
import { getApiRateLimiter } from "@/lib/parametric-engine/cache/upstash-client";
import { getSupabaseServerClient, savePolygonRoofConfig } from "@/lib/parametric-engine/db/supabase-client";
import { createClient } from "@/lib/supabase/server";

interface GeneratePolygonRequestBody {
  projectId: string;
  walls: WallSegment[];
  pitchDeg: number;
  overhangMm: number;
  thicknessMm: number;
}

export interface GeneratePolygonRoofResponse {
  cached: boolean;
  paramsHash: string;
  roofConfigId: string;
  partsInserted: number;
  roomCount: number;
  ridgeLengthMm: number;
  hipLengthMm: number;
  valleyLengthMm: number;
  roofSurfaceAreaMm2: number;
  bom: BOMLineItem[];
  warnings: string[];
}

/**
 * POST /api/roofs/generate-polygon
 *
 * The wall-geometry counterpart to /api/roofs/generate: instead of a
 * rectangular RoofParams object, this takes the project's drawn walls
 * directly and runs the straight-skeleton engine server-side, so freeform
 * plans (see the Wall Studio) get real fabrication output through the
 * exact same roof_configs -> parts -> /api/nesting pipeline the
 * rectangular roofs already use -- nesting reads parts by roof_config_id
 * and has no idea (or need to know) whether they came from a box or a
 * skeleton.
 *
 * One roof is generated per enclosed room (detectRooms), since a project
 * can have more than one separate enclosed area, each needing its own
 * roof rather than one shape spanning empty space between them.
 *
 * Deliberately recomputes from walls server-side rather than trusting a
 * client-sent footprint/BOM, for the same reason /api/roofs/generate
 * recomputes from params: the server is the source of truth for what gets
 * billed and cut, not whatever the browser happened to render.
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

  let body: GeneratePolygonRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, walls, pitchDeg, overhangMm, thicknessMm } = body;
  if (!projectId || !Array.isArray(walls) || walls.length === 0 || !pitchDeg) {
    return NextResponse.json({ error: "projectId, walls and pitchDeg are required" }, { status: 400 });
  }

  const orgId = user.app_metadata?.org_id ?? user.id;
  const { data: project, error: projectLookupErr } = await authed
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .single();
  if (projectLookupErr || !project || project.org_id !== orgId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  try {
    const rooms = detectRooms(walls);
    if (rooms.length === 0) {
      return NextResponse.json(
        { error: "These walls don't enclose a closed space yet, so there's no roof to generate. Close the floor plan first." },
        { status: 400 }
      );
    }

    const eaveHeightMm = Math.max(...walls.map((w) => w.heightMm));
    const storedParams = {
      footprints: rooms.map((r) => r.outline),
      pitchDeg,
      eaveHeightMm,
      overhangMm,
      thicknessMm,
    };
    const paramsHash = createHash("sha256")
      .update(JSON.stringify(storedParams, Object.keys(storedParams).sort()))
      .digest("hex")
      .slice(0, 32);

    const allParts: Part[] = [];
    const bomTotals = new Map<string, { unit: BOMLineItem["unit"]; description: string; quantity: number }>();
    let ridgeLengthMm = 0;
    let hipLengthMm = 0;
    let valleyLengthMm = 0;
    let roofSurfaceAreaMm2 = 0;
    const warnings: string[] = [];

    for (const room of rooms) {
      const roof = buildPolygonRoof(room.outline, { pitchDeg, eaveHeightMm, overhangMm });
      if (!roof) {
        warnings.push("One enclosed area's footprint couldn't be roofed (degenerate shape) and was skipped.");
        continue;
      }
      if (roof.warning) warnings.push(roof.warning);

      const fab = generateSkeletonRoofFabrication(roof, { pitchDeg, sheathingThicknessMm: thicknessMm });
      allParts.push(...fab.parts);
      ridgeLengthMm += roof.ridgeLengthMm;
      hipLengthMm += roof.hipLengthMm;
      valleyLengthMm += roof.valleyLengthMm;
      roofSurfaceAreaMm2 += fab.roofSurfaceAreaMm2;
      for (const line of fab.bom) {
        const existing = bomTotals.get(line.material);
        bomTotals.set(line.material, {
          unit: line.unit,
          description: line.description,
          quantity: Math.round(((existing?.quantity ?? 0) + line.quantity) * 100) / 100,
        });
      }
    }

    if (allParts.length === 0) {
      return NextResponse.json({ error: "No roof could be generated for this footprint." }, { status: 422 });
    }

    const supabase = getSupabaseServerClient();
    const { roofConfigId, partsInserted } = await savePolygonRoofConfig(supabase, projectId, storedParams, paramsHash, allParts);

    const response: GeneratePolygonRoofResponse = {
      cached: false,
      paramsHash,
      roofConfigId,
      partsInserted,
      roomCount: rooms.length,
      ridgeLengthMm,
      hipLengthMm,
      valleyLengthMm,
      roofSurfaceAreaMm2,
      bom: [...bomTotals.entries()].map(([material, v]) => ({ material, ...v })),
      warnings,
    };
    return NextResponse.json(response);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
