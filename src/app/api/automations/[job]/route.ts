import { NextResponse } from "next/server";
import { hasValidSecret } from "@/lib/agent/auth";
import { runAutomation } from "@/lib/campaigns";
import { checkCalendarChanges, syncPendingCalendar } from "@/lib/calendar/sync";
import { sendPendingNotices } from "@/lib/clinic-notices";
import { runSmileConnect } from "@/lib/smile-connect-link";
import { sendOfferFollowups } from "@/lib/followups";
import { sendDueSummaries } from "@/lib/daily-summary";
import { completePendingSummaries } from "@/lib/conversations-backfill";
import type { CampaignType } from "@/lib/types";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

// Endpoints para que n8n (o cualquier cron) dispare las campañas automáticas:
// POST /api/automations/recordatorios  (todos los días, ej. 10:00)
// POST /api/automations/recall         (una vez por semana)
// POST /api/automations/reactivacion   (una vez por mes)
// POST /api/automations/ausentes       (todos los días)
// POST /api/automations/encuestas      (todos los días, ej. 19:00)
// POST /api/automations/calendario     (cada 10 minutos: reintenta los eventos de Google Calendar,
//                                       avisa al equipo si un profesional movió o borró un turno en Google
//                                       escribe a quien no contestó los horarios que le ofreció el agente,
//                                       reintenta los avisos al consultorio por WhatsApp,
//                                       sincroniza Smile Connect por API, si alguna clínica lo prendió,
//                                       y, de lunes a viernes de 10 a 14, manda el resumen diario de Sofi al equipo)
// POST /api/automations/seguimientos   (solo esto último, si se prefiere un disparador aparte)
// POST /api/automations/resumen-sofi   (el resumen diario solo: lo dispara también la tarea diaria de Chapa Labs)
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
  if (job === "resumen-sofi") {
    try {
      return NextResponse.json({ ok: true, job, resumenes: await sendDueSummaries() });
    } catch (e) {
      return NextResponse.json({ ok: false, job, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  if (job === "calendario" || job === "seguimientos") {
    try {
      // Ya se dispara cada 10 minutos: el seguimiento de turnos ofrecidos va en la misma corrida,
      // sin pedir otro disparador en n8n. Si falla uno, el otro corre igual.
      const [calendar, followups, changes, notices, smile, summaries, talks] = await Promise.allSettled([
        job === "calendario" ? syncPendingCalendar() : Promise.resolve(null),
        sendOfferFollowups(),
        job === "calendario" ? checkCalendarChanges() : Promise.resolve(null),
        // Reintenta los avisos al consultorio por WhatsApp que no salieron.
        job === "calendario" ? sendPendingNotices() : Promise.resolve(null),
        // Smile Connect por API (solo las clínicas con la conexión prendida).
        job === "calendario" ? runSmileConnect() : Promise.resolve(null),
        job === "calendario" ? sendDueSummaries() : Promise.resolve(null),
        // Las charlas que quedaron sin resumen (si el webhook post-call de ElevenLabs no llegó).
        job === "calendario" ? completePendingSummaries() : Promise.resolve(null),
      ]);
      if (talks.status === "rejected") console.error("Completar resúmenes de conversaciones falló", talks.reason);
      if (summaries.status === "rejected") console.error("Resumen diario de Sofi falló", summaries.reason);
      if (followups.status === "rejected") console.error("Seguimiento de turnos ofrecidos falló", followups.reason);
      if (changes.status === "rejected") console.error("Revisión de cambios en Google Calendar falló", changes.reason);
      if (notices.status === "rejected") console.error("Avisos al consultorio fallaron", notices.reason);
      if (smile.status === "rejected") console.error("Smile Connect por API falló", smile.reason);
      if (calendar.status === "rejected") throw calendar.reason;
      return NextResponse.json({
        ok: true,
        job,
        ...(calendar.value && { sincronizados: calendar.value.ok, errores: calendar.value.error }),
        seguimientos: followups.status === "fulfilled" ? followups.value : { error: String(followups.reason) },
        ...(changes.status === "fulfilled" && changes.value && { cambios_en_google: changes.value }),
        ...(notices.status === "fulfilled" && notices.value && { avisos_al_consultorio: notices.value }),
        ...(smile.status === "fulfilled" && smile.value && Object.keys(smile.value).length > 0 && { smile_connect: smile.value }),
        ...(summaries.status === "fulfilled" && summaries.value?.length && { resumenes: summaries.value }),
        ...(talks.status === "fulfilled" && talks.value?.revisadas && { conversaciones_sin_resumen: talks.value }),
      });
    } catch (e) {
      return NextResponse.json({ ok: false, job, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }
  const type = JOBS[job];
  if (!type) return NextResponse.json({ error: `Automatización desconocida. Opciones: ${[...Object.keys(JOBS), "calendario", "seguimientos", "resumen-sofi"].join(", ")}` }, { status: 404 });
  const body = (await request.json().catch(() => ({}))) as { clinic_id?: string };
  try {
    const result = await runAutomation(type, body.clinic_id);
    return NextResponse.json({ ok: true, job, ...result });
  } catch (e) {
    return NextResponse.json({ ok: false, job, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
