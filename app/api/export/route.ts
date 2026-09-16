import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { qstash } from "@/lib/upstash";

/**
 * Only 'pdf' (client sign-off summary) is queued from here now. DXF export
 * moved to the parametric engine's per-sheet fabrication output
 * (components/NestingLayoutSVG.tsx, generated client-side after
 * POST /api/nesting) - that's the real, kerf-compensated, CNC-ready DXF.
 * This route's DXF branch would have been generating from stale
 * project_elements columns that roofs no longer write to.
 */
const exportSchema = z.object({
  projectId: z.string().uuid(),
  formats: z.array(z.enum(["pdf"])).min(1),
});

export async function POST(req: NextRequest) {
  const parsed = exportSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { projectId, formats } = parsed.data;
  const supabase = await createClient();

  await supabase.from("projects").update({ status: "approved" }).eq("id", projectId);

  const queued = await Promise.all(
    formats.map(async (format) => {
      const { data: exportRow } = await supabase
        .from("exports")
        .insert({ project_id: projectId, format, status: "queued" })
        .select()
        .single();

      const { messageId } = await qstash.publishJSON({
        url: `${process.env.APP_URL}/api/export/worker`,
        body: { exportId: exportRow!.id, projectId, format },
      });

      await supabase.from("exports").update({ qstash_message_id: messageId }).eq("id", exportRow!.id);
      return { format, exportId: exportRow!.id, messageId };
    })
  );

  return NextResponse.json({ queued }, { status: 202 });
}
