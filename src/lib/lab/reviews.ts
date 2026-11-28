import "server-only";
import { json, sql } from "../db";
import { elevenlabs } from "../elevenlabs";
import type { Clinic } from "../types";
import { judgeRealConversation, labJudgeConfigured, type RealVerdict } from "./judge";
import { versionAt } from "./prompt";
import { clinicContextFor } from "./runs";
import { automaticChecks, conversationScore } from "./score";
import { normalizeTranscript, storedTranscript, transcriptText, type LabLine } from "./transcript";

// Revisión de charlas reales: cada charla cerrada de una clínica con el laboratorio prendido se puntúa con
// la misma rúbrica que las simulaciones. Las de testers (modo prueba) van aparte, como «prueba en producción».

export type Candidate = {
  id: string;
  clinic_id: string;
  elevenlabs_conversation_id: string | null;
  transcript: unknown;
  started_at: string;
  is_test: boolean;
};

/** Las charlas con herramientas, desde ElevenLabs; si no se puede, las guardadas (sin herramientas). */
export async function linesFor(c: Candidate): Promise<LabLine[]> {
  if (c.elevenlabs_conversation_id) {
    try {
      const detail = await elevenlabs<{ transcript?: unknown }>(`/v1/convai/conversations/${encodeURIComponent(c.elevenlabs_conversation_id)}`);
      const lines = normalizeTranscript(detail.transcript);
      if (lines.some((l) => l.role === "sofi" && l.text)) return lines;
    } catch {
      // Sin detalle de ElevenLabs: se revisa con el texto guardado.
    }
  }
  return storedTranscript(c.transcript);
}

/** Las charlas reales cerradas que falta revisar (las de testers primero). */
export function reviewCandidates(limit: number) {
  return sql<Candidate[]>`
    select c.id, c.clinic_id, c.elevenlabs_conversation_id, c.transcript, c.started_at, c.is_test
    from conversations c join clinics k on k.id = c.clinic_id and k.lab_enabled
    where c.started_at > now() - interval '10 days' and c.started_at < now() - interval '30 minutes'
      and coalesce(c.status, '') <> 'in-progress'
      and jsonb_typeof(c.transcript) = 'array' and jsonb_array_length(c.transcript) >= 3
      and not exists (select 1 from lab_reviews r where r.conversation_id = c.id and r.error is null)
    order by c.is_test desc, c.started_at desc
    limit ${limit}`;
}

/** Guarda la revisión de una charla real (la del servidor o la de la suscripción). */
export async function saveRealReview(c: Pick<Candidate, "id" | "clinic_id" | "is_test" | "started_at">, lines: LabLine[], verdict: RealVerdict, reviewer: string | null = null): Promise<void> {
  const scored = conversationScore({ verdicts: automaticChecks(lines), judge: verdict.judge, judgeCritical: verdict.judgeCritical });
  const findings = verdict.judgeCritical && verdict.criticalReason
    ? [{ problema: verdict.criticalReason, cita: "", dimension: "seguridad", gravedad: "alta", mejora: "" }, ...verdict.findings]
    : verdict.findings;
  const fields = {
    prompt_hash: await versionAt(c.started_at),
    intent: verdict.intent,
    situation: verdict.situation,
    score: scored.score,
    dims: json(scored.dims),
    critical: scored.critical,
    findings: json(findings),
    summary: reviewer ? `${verdict.summary} (revisó: ${reviewer})` : verdict.summary,
    error: null,
    reviewed_at: new Date(),
  };
  await sql`
    insert into lab_reviews ${sql({ conversation_id: c.id, clinic_id: c.clinic_id, is_test: c.is_test, ...fields })}
    on conflict (conversation_id) do update set ${sql(fields)}`;
}

/** Revisa hasta `limit` charlas pendientes. Devuelve cuántas revisó. */
export async function reviewRecentConversations(budgetMs: number, limit = 6): Promise<number> {
  // Por regla (policy.ts) el servidor no revisa: lo hace la suscripción por /api/lab/evaluaciones.
  if (!labJudgeConfigured()) return 0;
  const started = Date.now();
  const candidates = await reviewCandidates(limit);
  let done = 0;
  const clinics = new Map<string, { clinic: Clinic; context: string; criteria: string[] }>();
  for (const c of candidates) {
    if (Date.now() - started > budgetMs) break;
    // Se reserva la charla para que otra vuelta del cron no la revise a la vez.
    const [claimed] = await sql`
      insert into lab_reviews (conversation_id, clinic_id, is_test, error) values (${c.id}, ${c.clinic_id}, ${c.is_test}, 'en revisión')
      on conflict do nothing returning conversation_id`;
    if (!claimed) continue;
    try {
      let info = clinics.get(c.clinic_id);
      if (!info) {
        const [clinic] = await sql<Clinic[]>`select * from clinics where id = ${c.clinic_id}`;
        const criteria = await sql<Array<{ text: string }>>`
          select text from lab_criteria where clinic_id is null or clinic_id = ${c.clinic_id} order by created_at desc limit 40`;
        info = { clinic, context: await clinicContextFor(clinic), criteria: criteria.map((r) => r.text) };
        clinics.set(c.clinic_id, info);
      }
      const lines = await linesFor(c);
      const verdict = await judgeRealConversation({ transcript: transcriptText(lines), clinicContext: info.context, criteria: info.criteria });
      await saveRealReview(c, lines, verdict);
      done++;
    } catch (e) {
      console.error("Laboratorio: no se pudo revisar una charla real", e instanceof Error ? e.message : e);
      await sql`update lab_reviews set error = ${(e instanceof Error ? e.message : String(e)).slice(0, 500)} where conversation_id = ${c.id}`;
    }
  }
  return done;
}
