import { NextRequest, NextResponse } from "next/server";
import { createRoof } from "@/lib/parametric-engine/core/createRoof";
import type { RoofParams } from "@/lib/parametric-engine/types";
import {
  getCachedRoofResult,
  setCachedRoofResult,
  hashRoofParams,
  getApiRateLimiter,
} from "@/lib/parametric-engine/cache/upstash-client";
import { getSupabaseServerClient, saveRoofConfig } from "@/lib/parametric-engine/db/supabase-client";
import { createClient } from "@/lib/supabase/server";

interface GenerateRequestBody {
  projectId: string;
  params: RoofParams;
}

export async function POST(req: NextRequest) {
  // Auth: the original engine route only rate-limited by IP. This app has
  // real logins now, so require one before touching a project's data.
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

  let body: GenerateRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const { projectId, params } = body;
  if (!projectId || !params) {
    return NextResponse.json({ error: "projectId and params are required" }, { status: 400 });
  }

  // Authorization: saveRoofConfig() below writes via the service client,
  // which bypasses RLS entirely -- so this route, not the database, is what
  // stops one user from writing roof data onto another org's project.
  const orgId = user.app_metadata?.org_id ?? user.id;
  const { data: project, error: projectLookupErr } = await authed
    .from("projects")
    .select("id, org_id")
    .eq("id", projectId)
    .single();
  if (projectLookupErr || !project || project.org_id !== orgId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const paramsHash = hashRoofParams(params);

  try {
    // 1. Cache check -- skip recompute entirely on a hit.
    const cached = await getCachedRoofResult(paramsHash);
    if (cached) {
      return NextResponse.json({ cached: true, paramsHash, ...cached });
    }

    // 2. Compute. Pure, framework-free engine -- identical output whether
    //    this runs here or in the browser preview.
    const roof = createRoof(params);
    const result = roof.generateAll();

    // 3. Persist parts + config against this app's own `projects` row
    //    (source of truth for downstream cutting jobs / nesting / DXF export).
    const supabase = getSupabaseServerClient();
    const { roofConfigId, partsInserted } = await saveRoofConfig(supabase, projectId, params, paramsHash, roof);

    // 4. Cache for next identical request.
    await setCachedRoofResult(paramsHash, result);

    return NextResponse.json({ cached: false, paramsHash, roofConfigId, partsInserted, ...result });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}


