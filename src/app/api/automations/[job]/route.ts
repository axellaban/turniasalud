import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/agent/auth";
import { runAutomation } from "@/lib/campaigns";
import { syncPendingCalendar } from "@/lib/calendar/sync";
import { sendOfferFollowups } from "@/lib/followups";
import type { CampaignType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Endpoints para que n8n (o cualquier cron) dispare las campañas automáticas:
// POST /api/automations/recordatorios  (todos los días, ej. 10:00)
// POST /api/automations/recall         (una vez por semana)
// POST /api/automations/reactivacion   (una vez por mes)
// POST /api/automations/ausentes       (todos los días)
// POST /api/automations/encuestas      (todos los días, ej. 19:00)
// POST /api/automations/calendario     (cada 10 minutos: reintenta los eventos de Google Calendar
//                                       y escribe a quien no contestó los horarios que le ofreció el agente)
// POST /api/automations/seguimientos   (solo esto último, si se prefiere un disparador aparte)
const JOBS: Record<string, CampaignType> = {
  recordatorios: "recordatorio",
  recall: "recall",
  reactivacion: "reactivacion",
  ausentes: "no_show",
  encuestas: "encuesta",
  "lista-espera": "lista_espera",
};

export async function POST(request: Request, { params }: { params: Promise<{ job: string }> }) {
  if (!hasValidSecret(request)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const { job } = await params;
  if (job === "calendario" || job === "seguimientos") {
    try {
      // Ya se dispara cada 10 minutos: el seguimiento de turnos ofrecidos va en la misma corrida,
      // sin pedir otro disparador en n8n. Si falla uno, el otro corre igual.
      const [calendar, followups] = await Promise.allSettled([
        job === "calendario" ? syncPendingCalendar() : Promise.resolve(null),
        sendOfferFollowups(),
      ]);
      if (followups.status === "rejected") console.error("Seguimiento de turnos ofrecidos falló", followups.reason);
      if (calendar.status === "rejected") throw calendar.reason;
      return NextResponse.json({
        ok: true,
        job,
        ...(calendar.value && { sincronizados: calendar.value.ok, errores: calendar.value.error }),
        seguimientos: followups.status === "fulfilled" ? followups.value : { error: String(followups.reason) },
      });
    } catch (e) {
      return NextResponse.json({ ok: false, job, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  const type = JOBS[job];
  if (!type) return NextResponse.json({ error: `Automatización desconocida. Opciones: ${[...Object.keys(JOBS), "calendario", "seguimientos"].join(", ")}` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { clinic_id?: string };
  try {
    const result = await runAutomation(type, body.clinic_id);
    return NextResponse.json({ ok: true, job, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, job, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
