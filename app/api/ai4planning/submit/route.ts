import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { createRoof } from "@/lib/parametric-engine/core/createRoof";
import type { RoofParams } from "@/lib/parametric-engine/types";

/**
 * POST /api/ai4planning/submit
 *
 * PROPOSED CONTRACT - NOT VERIFIED. AI4Planning doesn't exist as a live
 * service yet (per your message, you're building it as a companion
 * website), so this is a sensible-but-unconfirmed shape:
 *
 *   POST {baseUrl}/v1/submissions
 *   Authorization: Bearer {api_key}
 *   Body: {
 *     external_reference: "<our project id>",   // echoed back in the webhook
 *     project: { title, jobType, address },
 *     roof: { roofType, calculations, bom } | null,
 *     windows: [{ elevation, style, width, height, bom }],
 *   }
 *   Expected 201 response: { reference_id: string }
 *
 * Once AI4Planning's real API is defined, only the request-building and
 * response-parsing in this route need to change - the surrounding
 * auth/ownership/logging structure stays the same.
 *
 * Document attachment (the PDF quote, the DXF) is deliberately NOT sent
 * yet - those are generated client-side/on-demand today with no durable
 * hosted URL to hand to a third party, and there's no confirmed contract
 * yet for whether AI4Planning wants a multipart upload, a pre-signed URL,
 * or base64 inline. Flagged here rather than guessed at.
 */
const submitSchema = z.object({ projectId: z.string().uuid() });

export async function POST(req: NextRequest) {
  const authed = await createClient();
  const {
    data: { user },
  } = await authed.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = submitSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  const { projectId } = parsed.data;

  const orgId = user.app_metadata?.org_id ?? user.id;

  // Ownership check via the RLS-governed client, same pattern as
  // /api/roofs/generate - everything after this uses the service client.
  const { data: project, error: projectErr } = await authed
    .from("projects")
    .select("id, title, job_type, org_id, clients(address)")
    .eq("id", projectId)
    .single();
  if (projectErr || !project || project.org_id !== orgId) {
    return NextResponse.json({ error: "Project not found" }, { status: 404 });
  }

  const service = createServiceClient();

  const { data: integration } = await service
    .from("integration_settings")
    .select("api_key, base_url, enabled")
    .eq("org_id", orgId)
    .eq("provider", "ai4planning")
    .maybeSingle();

  if (!integration?.api_key || !integration?.base_url) {
    return NextResponse.json(
      { error: "AI4Planning isn't connected yet. Add an API key and base URL in Settings → Integrations." },
      { status: 400 }
    );
  }
  if (!integration.enabled) {
    return NextResponse.json({ error: "AI4Planning integration is disabled in Settings → Integrations." }, { status: 400 });
  }

  // Build the submission payload from whatever's actually on the project.
  const { data: roofConfig } = await service
    .from("roof_configs")
    .select("roof_type, params")
    .eq("project_id", projectId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  let roofPayload: unknown = null;
  if (roofConfig) {
    const roof = createRoof(roofConfig.params as RoofParams);
    const { calculations, bom } = roof.generateAll();
    roofPayload = { roofType: roofConfig.roof_type, calculations, bom };
  }

  const { data: windowRows } = await service
    .from("project_elements")
    .select("elevation, window_style, frame_width_m, frame_height_m")
    .eq("project_id", projectId)
    .eq("kind", "window");

  const payload = {
    external_reference: projectId,
    project: {
      title: project.title,
      jobType: project.job_type,
      address: (project as any).clients?.address ?? null,
    },
    roof: roofPayload,
    windows: windowRows ?? [],
  };

  // Log the attempt before the network call, not just on success - a
  // failed submission is still worth an audit trail of what we tried to send.
  const { data: submission, error: submissionErr } = await service
    .from("council_submissions")
    .insert({ project_id: projectId, status: "submitted", request_payload: payload })
    .select()
    .single();
  if (submissionErr) return NextResponse.json({ error: submissionErr.message }, { status: 500 });

  try {
    const res = await fetch(`${integration.base_url.replace(/\/$/, "")}/v1/submissions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${integration.api_key}`,
      },
      body: JSON.stringify(payload),
    });

    const responseBody = await res.json().catch(() => null);

    if (!res.ok) {
      await service
        .from("council_submissions")
        .update({ response_payload: responseBody, status: "withdrawn" })
        .eq("id", submission.id);
      return NextResponse.json(
        { error: `AI4Planning rejected the submission (HTTP ${res.status}). This may mean the API contract has changed since this route was written.` },
        { status: 502 }
      );
    }

    await service
      .from("council_submissions")
      .update({ ai4planning_reference_id: responseBody?.reference_id ?? null, response_payload: responseBody })
      .eq("id", submission.id);

    await service.from("projects").update({ status: "submitted_for_council" }).eq("id", projectId);

    return NextResponse.json({ submissionId: submission.id, referenceId: responseBody?.reference_id ?? null });
  } catch (err) {
    // Network-level failure (DNS, connection refused, etc) - very likely
    // right now since AI4Planning may not have a live endpoint yet. Keep
    // the submission row so there's a record of what was attempted.
    const message = err instanceof Error ? err.message : "Unknown network error";
    await service.from("council_submissions").update({ status: "withdrawn" }).eq("id", submission.id);
    return NextResponse.json(
      { error: `Could not reach AI4Planning at ${integration.base_url}: ${message}` },
      { status: 502 }
    );
  }
}
