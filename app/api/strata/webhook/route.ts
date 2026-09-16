import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { rateLimit } from "@/lib/upstash";
import crypto from "crypto";

/**
 * This project doesn't yet require Strata sync to function - projects are
 * created directly in-app. This route is here so that when you confirm
 * whether Strata gives you a direct webhook URL or routes through
 * Zapier/Make, wiring it in is additive rather than a redesign.
 *
 * If it turns out to go through Zapier/Make instead of a native webhook,
 * point the Zap's "Webhooks by Zapier" action at this same URL - the
 * payload shape below is what this route expects either way.
 */

const ORG_ID_FOR_THIS_STRATA_ACCOUNT = process.env.STRATA_ORG_ID!;

function verifySignature(rawBody: string, signature: string | null) {
  if (!process.env.STRATA_WEBHOOK_SECRET) return true; // no secret configured yet
  if (!signature) return false;
  const expected = crypto
    .createHmac("sha256", process.env.STRATA_WEBHOOK_SECRET)
    .update(rawBody)
    .digest("hex");
  return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}

export async function POST(req: NextRequest) {
  const ip = req.headers.get("x-forwarded-for") ?? "unknown";
  const allowed = await rateLimit(`strata-webhook:${ip}`, 60, 60);
  if (!allowed) return NextResponse.json({ error: "Rate limited" }, { status: 429 });

  const rawBody = await req.text();
  const signature = req.headers.get("x-strata-signature");
  if (!verifySignature(rawBody, signature)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody);
  const supabase = createServiceClient();

  await supabase.from("strata_sync_log").insert({
    direction: "inbound",
    event_type: event.type,
    strata_job_id: event.job?.id,
    payload: event,
  });

  // Adjust field names once you have a real payload sample from Strata or
  // from the Zapier "Webhooks by Zapier" test payload.
  if (event.type === "job.booked") {
    const { data: existing } = await supabase
      .from("clients")
      .select("id")
      .eq("strata_client_id", event.client.id)
      .maybeSingle();

    const clientId =
      existing?.id ??
      (
        await supabase
          .from("clients")
          .insert({
            org_id: ORG_ID_FOR_THIS_STRATA_ACCOUNT,
            name: event.client.name,
            phone: event.client.phone,
            address: event.client.address,
            strata_client_id: event.client.id,
            source: "strata",
          })
          .select("id")
          .single()
      ).data?.id;

    const { data: project } = await supabase
      .from("projects")
      .insert({
        org_id: ORG_ID_FOR_THIS_STRATA_ACCOUNT,
        client_id: clientId,
        title: event.job.service_name ?? "Untitled job",
        job_type: "roof",
        status: "draft",
        strata_job_id: event.job.id,
      })
      .select()
      .single();

    return NextResponse.json({ ok: true, projectId: project?.id }, { status: 201 });
  }

  return NextResponse.json({ ok: true, ignored: event.type });
}
