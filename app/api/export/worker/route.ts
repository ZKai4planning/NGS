import { NextRequest, NextResponse } from "next/server";
import { verifySignatureAppRouter } from "@upstash/qstash/nextjs";
import { createServiceClient } from "@/lib/supabase/server";
import { createRoof } from "@/lib/parametric-engine/core/createRoof";
import type { RoofParams } from "@/lib/parametric-engine/types";

// jsPDF runs fine in a Node serverless function.
export const runtime = "nodejs";

async function handler(req: NextRequest) {
  const { exportId, projectId } = await req.json();
  const supabase = createServiceClient();

  await supabase.from("exports").update({ status: "processing" }).eq("id", exportId);

  try {
    // Pull the most recently generated roof config for this project and
    // recompute from params - deterministic, so no need to also store the
    // full generateAll() output redundantly.
    const { data: config, error: configErr } = await supabase
      .from("roof_configs")
      .select("params")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (configErr) throw configErr;

    const roof = createRoof(config.params as RoofParams);
    const { calculations, bom } = roof.generateAll();

    const { jsPDF } = await import("jspdf");
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("NGS - roof quote, client sign-off", 20, 20);
    doc.setFontSize(11);
    doc.text(`Roof type: ${config.params.type}`, 20, 33);

    let y = 41;
    for (const [key, value] of Object.entries(calculations)) {
      doc.text(`${key}: ${typeof value === "number" ? value.toFixed(2) : value}`, 20, y);
      y += 7;
    }

    y += 4;
    doc.setFontSize(12);
    doc.text("Bill of materials", 20, y);
    doc.setFontSize(11);
    y += 8;
    for (const item of bom) {
      doc.text(`${item.material}: ${item.quantity} ${item.unit}`, 20, y);
      y += 7;
    }

    const fileBuffer = Buffer.from(doc.output("arraybuffer"));
    const filePath = `${projectId}/${exportId}.pdf`;

    const { error: uploadErr } = await supabase.storage
      .from("exports")
      .upload(filePath, fileBuffer, { contentType: "application/pdf", upsert: true });
    if (uploadErr) throw uploadErr;

    await supabase
      .from("exports")
      .update({ status: "ready", file_path: filePath, completed_at: new Date().toISOString() })
      .eq("id", exportId);

    return NextResponse.json({ ok: true, filePath });
  } catch (err: any) {
    await supabase.from("exports").update({ status: "failed", error: String(err.message ?? err) }).eq("id", exportId);
    return NextResponse.json({ ok: false, error: String(err.message ?? err) }, { status: 500 });
  }
}

export const POST = verifySignatureAppRouter(handler);
