import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

function mask(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

/**
 * GET /api/settings/integrations/ai4planning
 * Current config, masked. If nothing is saved yet, returns nulls rather
 * than a 404 - "not configured" is a normal state, not an error.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("integration_settings")
    .select("*")
    .eq("provider", "ai4planning")
    .maybeSingle();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    connected: Boolean(data?.api_key),
    baseUrl: data?.base_url ?? null,
    apiKeyMasked: mask(data?.api_key ?? null),
    webhookSecretMasked: mask(data?.webhook_secret ?? null),
    enabled: data?.enabled ?? true,
    updatedAt: data?.updated_at ?? null,
  });
}

const saveSchema = z.object({
  baseUrl: z.string().url(),
  apiKey: z.string().min(1),
  // Optional: if omitted and none exists yet, one is generated server-side.
  webhookSecret: z.string().min(16).optional(),
});

/**
 * POST /api/settings/integrations/ai4planning
 * Saves or rotates the connection. apiKey is required every call - this
 * is a "set" operation, not a partial patch, so there's no ambiguity about
 * whether omitting it means "leave unchanged" or "clear it."
 */
export async function POST(req: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const parsed = saveSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const orgId = user.app_metadata?.org_id ?? user.id;
  const webhookSecret = parsed.data.webhookSecret ?? crypto.randomUUID().replace(/-/g, "");

  const { data, error } = await supabase
    .from("integration_settings")
    .upsert(
      {
        org_id: orgId,
        provider: "ai4planning",
        base_url: parsed.data.baseUrl,
        api_key: parsed.data.apiKey,
        webhook_secret: webhookSecret,
        enabled: true,
      },
      { onConflict: "org_id,provider" }
    )
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    connected: true,
    baseUrl: data.base_url,
    apiKeyMasked: mask(data.api_key),
    webhookSecretMasked: mask(data.webhook_secret),
    // The secret is returned in full ONLY on this save response, so it can
    // be shown once to copy into AI4Planning's own webhook config - after
    // this, only the masked form is ever returned again.
    webhookSecretFull: data.webhook_secret,
  });
}

export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const orgId = user.app_metadata?.org_id ?? user.id;
  const { error } = await supabase
    .from("integration_settings")
    .delete()
    .eq("org_id", orgId)
    .eq("provider", "ai4planning");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ disconnected: true });
}
