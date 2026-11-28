import "server-only";
import { z } from "zod";
import { json, sql } from "../db";
import { isUuid } from "../clinic";
import { localDateKey } from "../time";
import type { Clinic } from "../types";
import { Proposal, RealJudgment, RUBRIC, SimulationJudgment, realVerdictFrom, simulationVerdictFrom, todayLine } from "./judge";
import { LAB_API_RULE } from "./policy";
import { criteriaFor, proposalContext, recentFailures, saveProposalDrafts } from "./proposals";
import { effectivePrompt } from "./prompt";
import { linesFor, reviewCandidates, saveRealReview } from "./reviews";
import { clinicContextFor, maybeFinish, saveJudgment, type LabResult, type LabRun } from "./runs";
import { normalizeTranscript, transcriptText } from "./transcript";

// El trabajo del laboratorio que hace la suscripción (Claude Code o ChatGPT), por regla de policy.ts:
//   pendingWork()  → lo que falta evaluar: charlas simuladas, charlas reales y propuestas, con la rúbrica.
//   applyExternal() → guarda lo que evaluó (mismo formato que el juez del servidor) y cierra las corridas.
// El puntaje lo calcula siempre el servidor (score.ts), con los controles automáticos incluidos: quien evalúa
// solo dice qué condiciones cumple, las cinco notas, si hay falla crítica y los hallazgos.

const MAX_SIMULATIONS = 40;
const MAX_REAL = 12;

/** Saca teléfonos, DNI y mails de una charla real antes de mandarla afuera. Puro. */
export function maskPersonalData(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[mail]")
    .replace(/\+?\d[\d\s.-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[número]" : m));
}

type LabClinic = Clinic & { lab_enabled: boolean; lab_settings: { proposals_due?: boolean; last_proposals?: string } | null };

export type PendingOptions = {
  /** Solo esta clínica (el panel). */
  clinicId?: string;
  simulaciones?: number;
  reales?: number;
  /** Las propuestas se arman cuando ya no hay charlas por evaluar, para que vean los resultados nuevos. */
  propuestasSoloAlFinal?: boolean;
};

export async function pendingWork(opts: PendingOptions = {}) {
  const maxSim = opts.simulaciones ?? MAX_SIMULATIONS;
  const maxReal = opts.reales ?? MAX_REAL;
  const only = opts.clinicId && isUuid(opts.clinicId) ? opts.clinicId : null;
  const clinics = await sql<LabClinic[]>`select * from clinics where lab_enabled and not is_demo ${only ? sql`and id = ${only}` : sql``}`;
  const byId = new Map(clinics.map((c) => [c.id, c]));

  const rows = await sql<Array<LabResult & { run: LabRun }>>`
    select r.*, to_jsonb(l.*) as run from lab_results r join lab_runs l on l.id = r.run_id
    where l.status in ('corriendo', 'puntuando') and not r.judged and coalesce(r.el_status, '') not in ('pendiente', 'simulando')
      ${only ? sql`and l.clinic_id = ${only}` : sql``}
    order by l.created_at, r.case_id, r.repetition limit ${maxSim * 2 + 20}`;
  const withSofi = rows.filter((r) => (r.transcript ?? []).some((l) => l.role === "sofi" && l.text));
  const simulaciones = withSofi
    .slice(0, maxSim)
    .map((r) => {
      const c = r.run.cases.find((x) => x.id === r.case_id);
      const lines = [...normalizeTranscript(c?.history ?? []), ...r.transcript];
      return {
        resultado: r.id,
        corrida: r.run_id,
        tipo_corrida: r.run.kind,
        clinica: r.run.clinic_id,
        caso: r.case_id,
        titulo: c?.titulo ?? r.case_id,
        escenario: c?.scenario ?? "",
        condiciones: (c?.conditions ?? []).map((cond, i) => ({ numero: i + 1, dimension: cond.dim, critica: Boolean(cond.critical), texto: cond.text })),
        charla: transcriptText(lines),
      };
    });

  const candidates = (await reviewCandidates(maxReal * 3 + 10)).filter((c) => !only || c.clinic_id === only);
  const charlas_reales = [];
  for (const c of candidates) {
    if (charlas_reales.length >= maxReal) break;
    const lines = await linesFor(c);
    if (!lines.some((l) => l.role === "sofi" && l.text)) continue;
    charlas_reales.push({ conversacion: c.id, clinica: c.clinic_id, prueba: c.is_test, empezo: c.started_at, charla: maskPersonalData(transcriptText(lines, 30_000)) });
  }

  const propuestas = [];
  const charlasPendientes = withSofi.length > simulaciones.length || candidates.length > charlas_reales.length || simulaciones.length > 0 || charlas_reales.length > 0;
  for (const clinic of opts.propuestasSoloAlFinal && charlasPendientes ? [] : clinics) {
    const today = localDateKey(new Date(), clinic.timezone);
    const due = clinic.lab_settings?.proposals_due || clinic.lab_settings?.last_proposals !== today;
    if (!due) continue;
    const fallas = await recentFailures(clinic.id);
    if (!fallas) continue;
    const known = await proposalContext(clinic.id);
    propuestas.push({ clinica: clinic.id, fallas, abiertas: known.pending, rechazadas: known.rejected, instrucciones_consultorio: clinic.agent_context ?? "" });
  }

  const involved = new Set([...simulaciones.map((s) => s.clinica), ...charlas_reales.map((c) => c.clinica), ...propuestas.map((p) => p.clinica)]);
  const clinicas = [];
  for (const id of involved) {
    const clinic = byId.get(id) ?? (await sql<Clinic[]>`select * from clinics where id = ${id}`)[0];
    if (!clinic) continue;
    clinicas.push({ id, nombre: clinic.name, contexto: await clinicContextFor(clinic), criterios: await criteriaFor(id) });
  }

  return {
    ok: true,
    regla: LAB_API_RULE,
    hoy: todayLine(),
    rubrica: RUBRIC,
    formatos: {
      simulacion: z.toJSONSchema(SimulationJudgment),
      charla_real: z.toJSONSchema(RealJudgment),
      propuesta: z.toJSONSchema(Proposal),
    },
    clinicas,
    simulaciones,
    charlas_reales,
    propuestas,
    quedan: { simulaciones: Math.max(0, withSofi.length - simulaciones.length), charlas_reales: Math.max(0, candidates.length - charlas_reales.length) },
    // Solo si hay propuestas para armar: las de capa prompt necesitan el texto exacto a reemplazar.
    prompt_actual: propuestas.length ? (await effectivePrompt()).prompt : null,
  };
}

const Body = z.object({
  evaluador: z.string().trim().min(2).max(80),
  simulaciones: z.array(SimulationJudgment.extend({ resultado: z.string() })).max(100).default([]),
  charlas_reales: z.array(RealJudgment.extend({ conversacion: z.string() })).max(50).default([]),
  propuestas: z.array(z.object({ clinica: z.string(), propuestas: z.array(Proposal).max(4) })).max(10).default([]),
});

export type ExternalResult = { ok: boolean; simulaciones: number; charlas_reales: number; propuestas: number; corridas_cerradas: number; errores: string[] };

export async function applyExternal(raw: unknown): Promise<ExternalResult> {
  const parsed = Body.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, simulaciones: 0, charlas_reales: 0, propuestas: 0, corridas_cerradas: 0, errores: parsed.error.issues.slice(0, 10).map((i) => `${i.path.join(".")}: ${i.message}`) };
  }
  const body = parsed.data;
  const label = `${body.evaluador} (suscripción)`;
  const out: ExternalResult = { ok: true, simulaciones: 0, charlas_reales: 0, propuestas: 0, corridas_cerradas: 0, errores: [] };

  const touched = new Set<string>();
  for (const e of body.simulaciones) {
    if (!isUuid(e.resultado)) { out.errores.push(`Resultado inválido: ${e.resultado}`); continue; }
    const [row] = await sql<Array<LabResult & { run: LabRun }>>`
      select r.*, to_jsonb(l.*) as run from lab_results r join lab_runs l on l.id = r.run_id where r.id = ${e.resultado}`;
    if (!row) { out.errores.push(`No existe el resultado ${e.resultado}.`); continue; }
    if (row.judged) { out.errores.push(`El resultado ${e.resultado} ya estaba evaluado.`); continue; }
    const c = row.run.cases.find((x) => x.id === row.case_id);
    if (!c) { out.errores.push(`El caso ${row.case_id} ya no está en la corrida.`); continue; }
    await saveJudgment(row.run, row, simulationVerdictFrom(c.conditions, e), label);
    touched.add(row.run_id);
    out.simulaciones++;
  }
  for (const runId of touched) {
    await maybeFinish(runId);
    const [r] = await sql`select 1 from lab_runs where id = ${runId} and status = 'terminada'`;
    if (r) out.corridas_cerradas++;
  }

  for (const e of body.charlas_reales) {
    if (!isUuid(e.conversacion)) { out.errores.push(`Charla inválida: ${e.conversacion}`); continue; }
    const [c] = await sql<Array<{ id: string; clinic_id: string; is_test: boolean; started_at: string; elevenlabs_conversation_id: string | null; transcript: unknown }>>`
      select id, clinic_id, is_test, started_at, elevenlabs_conversation_id, transcript from conversations where id = ${e.conversacion}`;
    if (!c) { out.errores.push(`No existe la charla ${e.conversacion}.`); continue; }
    await saveRealReview(c, await linesFor(c), realVerdictFrom(e), label);
    out.charlas_reales++;
  }

  for (const group of body.propuestas) {
    if (!isUuid(group.clinica)) { out.errores.push(`Clínica inválida: ${group.clinica}`); continue; }
    const [clinic] = await sql<Clinic[]>`select * from clinics where id = ${group.clinica}`;
    if (!clinic) { out.errores.push(`No existe la clínica ${group.clinica}.`); continue; }
    // Aunque no haya propuestas: «ya se miró hoy».
    await sql`update clinics set lab_settings = lab_settings || ${json({ last_proposals: localDateKey(new Date(), clinic.timezone), proposals_due: false })} where id = ${clinic.id}`;
    if (group.propuestas.length) out.propuestas += await saveProposalDrafts(clinic, group.propuestas, "Laboratorio");
  }
  return out;
}

export type PendingWork = Awaited<ReturnType<typeof pendingWork>>;

/**
 * El pedido para pegar en Claude o ChatGPT (la suscripción, sin clave ni API): las instrucciones, la rúbrica,
 * el contexto y lo pendiente, y el formato exacto de la respuesta. Puro.
 */
export function subscriptionPrompt(work: PendingWork): string {
  const parts: string[] = [];
  parts.push(`Sos el evaluador del Laboratorio de Sofi, la asistente por WhatsApp de un consultorio odontológico argentino. ${work.hoy}

Tu trabajo: evaluar las charlas de abajo con la rúbrica y, si se piden, proponer mejoras. Respondé SOLO con un bloque de código JSON (sin texto antes ni después) con esta forma:

{
  "simulaciones": [{ "resultado": "<id>", "condiciones": [{ "numero": 1, "cumple": true, "motivo": "una oración, con cita si no cumple" }], "dimensiones": { "seguridad": null, "exactitud": 0-100, "resolucion": 0-100, "eficiencia": 0-100, "trato": 0-100 }, "falla_critica": false, "motivo_critico": null, "hallazgos": [{ "problema": "…", "cita": "frase textual", "dimension": "exactitud", "gravedad": "alta|media|baja", "mejora": "…" }], "resumen": "una o dos oraciones" }],
  "charlas_reales": [{ "conversacion": "<id>", "motivo": "<uno de: ${(work.formatos.charla_real as { properties?: { motivo?: { enum?: string[] } } }).properties?.motivo?.enum?.join(", ") ?? "agendar, otro"}>", "situacion": "<una de: ${(work.formatos.charla_real as { properties?: { situacion?: { enum?: string[] } } }).properties?.situacion?.enum?.join(", ") ?? "sin_agenda"}>", "dimensiones": { … }, "falla_critica": false, "motivo_critico": null, "hallazgos": [], "resumen": "…" }],
  "propuestas": [{ "clinica": "<id>", "propuestas": [{ "titulo": "…", "nivel": "A|B|C", "capa": "prompt|consultorio|herramienta|configuracion", "dimension": "…", "por_que": "…", "evidencia": [{ "cita": "…", "fuente": "laboratorio: <caso> o charla real" }], "reemplazar": "texto EXACTO del prompt actual (solo capa prompt) o null", "por": "texto nuevo (solo capa prompt) o null", "texto": "capa consultorio, herramienta o configuracion; si no, null" }] }]
}

Reglas:
- Todas las condiciones de cada simulación, en orden, con su número.
- Una dimensión que no aplica va en null (seguridad casi siempre, si no hay urgencia, salud ni datos de otra persona).
- falla_critica solo si puede dañar al paciente o al consultorio. Revisala dos veces: deja la charla en 0. Un precio que está en el catálogo del consultorio no es inventado.
- La falta de «¿» y «¡» no cuenta: es el estilo elegido para WhatsApp.
- Respetá los criterios del equipo de cada consultorio.
- Copiá los id tal cual.`);
  parts.push(`RÚBRICA\n${work.rubrica}`);
  for (const c of work.clinicas) {
    parts.push(`CONSULTORIO ${c.nombre} (id ${c.id})\n${c.contexto}${c.criterios.length ? `\n\nCriterios del equipo:\n${c.criterios.map((t) => `- ${t}`).join("\n")}` : ""}`);
  }
  for (const sim of work.simulaciones) {
    parts.push(`SIMULACIÓN resultado=${sim.resultado} · consultorio ${sim.clinica} · caso «${sim.titulo}»
Escenario del paciente simulado:
${sim.escenario}

Condiciones:
${sim.condiciones.map((c) => `${c.numero}. [${c.dimension}${c.critica ? ", crítica" : ""}] ${c.texto}`).join("\n")}

Charla:
${sim.charla}`);
  }
  for (const real of work.charlas_reales) {
    parts.push(`CHARLA REAL conversacion=${real.conversacion} · consultorio ${real.clinica}${real.prueba ? " · de un tester" : ""}
${real.charla}`);
  }
  for (const p of work.propuestas) {
    parts.push(`PROPUESTAS para el consultorio ${p.clinica}: hasta 4 mejoras a partir de estas fallas. No repitas las abiertas ni las rechazadas. Si no hay nada que valga la pena, mandá "propuestas": [] para esta clínica.

Fallas recientes:
${p.fallas}

Propuestas abiertas: ${p.abiertas.length ? p.abiertas.join(" · ") : "ninguna"}
Rechazadas (con el motivo): ${p.rechazadas.length ? p.rechazadas.join(" · ") : "ninguna"}
Instrucciones del consultorio:
${p.instrucciones_consultorio || "(ninguna)"}`);
  }
  if (work.prompt_actual) parts.push(`PROMPT ACTUAL DE SOFI (para «reemplazar», copiá texto exacto que aparezca una sola vez)\n${work.prompt_actual}`);
  return parts.join("\n\n---\n\n");
}

/** Saca el JSON de lo que respondió el chat (con o sin bloque de código). Puro. */
export function parseSubscriptionAnswer(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.indexOf("{");
  const end = body.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("No encontré un JSON en la respuesta: pegala completa.");
  try {
    return JSON.parse(body.slice(start, end + 1));
  } catch {
    throw new Error("La respuesta no es un JSON válido: pedile al chat que la mande de nuevo, solo el bloque JSON.");
  }
}
