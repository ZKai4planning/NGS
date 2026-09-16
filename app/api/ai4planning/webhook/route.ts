import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import crypto from "crypto";

/**
 * POST /api/ai4planning/webhook
 *
 * PROPOSED CONTRACT - same caveat as app/api/ai4planning/submit/route.ts.
 * Expected body:
 *   {
 *     external_reference: "<our project id>",   // what we sent in submit
 *     reference_id: "<their submission id>",
 *     decision: "approved" | "rejected",
 *     notes?: string
 *   }
 * Signed the same way app/api/strata/webhook/route.ts expects Strata to
 * sign - HMAC-SHA256 of the raw body using the org's webhook_secret, sent
 * as an `X-AI4Planning-Signature` header. Since this webhook has no
 * logged-in user (it's a server-to-server call from AI4Planning), the org
 * is identified by looking up which org's submission matches
 * external_reference/reference_id BEFORE trusting the signature - the
 * signature is then checked against THAT org's stored secret, not a
 * single global secret.
 */
function verifySignature(rawBody: string, signature: string | null, secret: string): boolean {
  if (!signature) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false; // length mismatch etc - timingSafeEqual throws rather than returning false
  }
}

export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-ai4planning-signature");

  let event: { external_reference?: string; reference_id?: string; decision?: string; notes?: string };
  try {
    event = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!event.external_reference || !event.decision) {
    return NextResponse.json({ error: "external_reference and decision are required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Find the project this decision is about, and via it, the org whose
  // secret should have signed this request.
  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .select("id, org_id")
    .eq("id", event.external_reference)
    .maybeSingle();
  if (projectErr || !project) {
    return NextResponse.json({ error: "Unknown external_reference" }, { status: 404 });
  }

  const { data: integration } = await supabase
    .from("integration_settings")
    .select("webhook_secret")
    .eq("org_id", project.org_id)
    .eq("provider", "ai4planning")
    .maybeSingle();

  if (!integration?.webhook_secret || !verifySignature(rawBody, signature, integration.webhook_secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event.decision !== "approved" && event.decision !== "rejected") {
    return NextResponse.json({ error: "decision must be 'approved' or 'rejected'" }, { status: 400 });
  }

  // Update the most recent submission for this project.
  const { data: submission } = await supabase
    .from("council_submissions")
    .select("id")
    .eq("project_id", project.id)
    .order("submitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (submission) {
    await supabase
      .from("council_submissions")
      .update({
        status: event.decision,
        decision_notes: event.notes ?? null,
        decided_at: new Date().toISOString(),
        response_payload: event,
      })
      .eq("id", submission.id);
  }

  await supabase
    .from("projects")
    .update({ status: event.decision === "approved" ? "council_approved" : "council_rejected" })
    .eq("id", project.id);

  return NextResponse.json({ ok: true });
}
