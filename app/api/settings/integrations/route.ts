import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

function mask(value: string | null): string | null {
  if (!value) return null;
  if (value.length <= 4) return "••••";
  return `••••${value.slice(-4)}`;
}

/**
 * GET /api/settings/integrations
 * Returns every provider's connection status for the signed-in org, with
 * api_key/webhook_secret masked to their last 4 characters. Never returns
 * the raw values - the AI4Planning settings page has its own route for
 * writing a new key, but reading one back out in full is never exposed.
 */
export async function GET() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const { data, error } = await supabase
    .from("integration_settings")
    .select("provider, base_url, enabled, updated_at, api_key, webhook_secret");

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const integrations = (data ?? []).map((row) => ({
    provider: row.provider,
    baseUrl: row.base_url,
    enabled: row.enabled,
    updatedAt: row.updated_at,
    apiKeyMasked: mask(row.api_key),
    webhookSecretMasked: mask(row.webhook_secret),
    connected: Boolean(row.api_key || row.webhook_secret),
  }));

  return NextResponse.json({ integrations });
}
