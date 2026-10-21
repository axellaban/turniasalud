import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/agent/auth";
import { runAutomation } from "@/lib/campaigns";
import type { CampaignType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Endpoints para que n8n (o cualquier cron) dispare las campañas automáticas:
// POST /api/automations/recordatorios  (todos los días, ej. 10:00)
// POST /api/automations/recall         (una vez por semana)
// POST /api/automations/reactivacion   (una vez por mes)
// POST /api/automations/ausentes       (todos los días)
const JOBS: Record<string, CampaignType> = {
  recordatorios: "recordatorio",
  recall: "recall",
  reactivacion: "reactivacion",
  ausentes: "no_show",
  "lista-espera": "lista_espera",
};

export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!hasValidSecret(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { job } = await params;
  const type = JOBS[job];
  if (!type) return NextResponse.json({ error: `Automatización desconocida. Opciones: ${Object.keys(JOBS).join(", ")}` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { clinic_id?: string };
  try {
    const result = await runAutomation(type, body.clinic_id);
    return NextResponse.json({ ok: true, job, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, job, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
