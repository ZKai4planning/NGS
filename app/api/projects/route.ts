import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const createProjectSchema = z.object({
  clientName: z.string().min(1),
  clientPhone: z.string().optional(),
  clientAddress: z.string().optional(),
  jobType: z.enum(["roof", "window", "roof_and_window"]),
  title: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = createProjectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { clientName, clientPhone, clientAddress, jobType, title } = parsed.data;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  // Solo installers: no separate org-onboarding flow yet, so the user's own
  // id doubles as org_id. Swap this for a real org lookup once multiple
  // installers share one NGS account.
  const orgId = user.app_metadata?.org_id ?? user.id;

  // In-app creation: no strata_client_id, source stays 'manual'.
  const { data: client, error: clientErr } = await supabase
    .from("clients")
    .insert({
      org_id: orgId,
      name: clientName,
      phone: clientPhone,
      address: clientAddress,
      source: "manual",
    })
    .select()
    .single();
  if (clientErr) return NextResponse.json({ error: clientErr.message }, { status: 500 });

  const { data: project, error: projectErr } = await supabase
    .from("projects")
    .insert({
      org_id: orgId,
      client_id: client.id,
      title,
      job_type: jobType,
      status: "draft",
      created_by: user.id,
    })
    .select()
    .single();
  if (projectErr) return NextResponse.json({ error: projectErr.message }, { status: 500 });

  return NextResponse.json({ project, client }, { status: 201 });
}

export async function GET() {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("projects")
    .select("*, clients(name, address, source)")
    .order("created_at", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ projects: data });
}
