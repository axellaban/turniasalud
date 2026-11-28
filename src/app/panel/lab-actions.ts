"use server";

import { createHash, randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { json, sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { getPanelClinic, requireAdmin } from "@/lib/panel-clinic";
import { labJudgeConfigured } from "@/lib/lab/judge";
import {
  addCriterion, approveProposal, draftLabCase, generateProposals, proposeFromResult, rejectProposal, revertProposal, saveCase, startExperiment,
} from "@/lib/lab/proposals";
import { advanceRun, allCases, getRun, startRun } from "@/lib/lab/runs";
import { fillCoverage } from "@/lib/lab/coverage";
import { storedTranscript, transcriptText } from "@/lib/lab/transcript";
import { LAB_SUBSCRIPTION_MESSAGE } from "@/lib/lab/policy";

// Panel → Turnia → Laboratorio de Sofi. Solo el administrador de Turnia.

export type LabFormState = { ok: boolean; message: string } | undefined;

const ACTOR = "Turnia (panel)";
const text = (form: FormData, key: string) => {
  const v = form.get(key);
  return typeof v === "string" ? v.trim() : "";
};
const fail = (e: unknown): LabFormState => ({ ok: false, message: e instanceof Error ? e.message : String(e) });
const done = (message: string): LabFormState => {
  revalidatePath("/panel/laboratorio", "layout");
  return { ok: true, message };
};

async function adminClinic(form: FormData) {
  await requireAdmin();
  return getPanelClinic(form);
}

/** Correr la batería completa ahora (lleva a la corrida). */
export async function labRunBattery(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  let id: string;
  try {
    const repeat = Number(text(form, "repetir") || 1);
    id = await startRun({ clinic, kind: "bateria", label: "Batería pedida desde el panel", cases: await allCases(clinic.id), repeat, createdBy: ACTOR });
  } catch (e) {
    return fail(e);
  }
  startNow(id);
  redirect(`/panel/laboratorio/corridas/${id}`);
}

/** «Jugar de paciente» con la IA: un caso existente o uno nuevo descripto en palabras. */
export async function labPlay(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  const caseId = text(form, "caso");
  const description = text(form, "descripcion");
  const repeat = Math.min(5, Math.max(1, Number(text(form, "repetir") || 2)));
  let id: string;
  try {
    let labCase;
    if (description) {
      if (!labJudgeConfigured()) return { ok: false, message: LAB_SUBSCRIPTION_MESSAGE };
      labCase = await draftLabCase(clinic, description);
    } else {
      labCase = (await allCases(clinic.id)).find((c) => c.id === caseId);
      if (!labCase) return { ok: false, message: "Elegí un caso o describí uno nuevo." };
    }
    id = await startRun({ clinic, kind: "jugar", label: labCase.titulo, cases: [labCase], repeat, createdBy: ACTOR });
  } catch (e) {
    return fail(e);
  }
  startNow(id);
  redirect(`/panel/laboratorio/corridas/${id}`);
}

/** Trae resultados y puntúa lo que falta de una corrida (también lo hace el cron cada 10 minutos). */
export async function labAdvance(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  const id = text(form, "corrida");
  if (!isUuid(id)) return { ok: false, message: "Falta la corrida." };
  try {
    const run = await advanceRun(id, 100_000);
    return done(run?.status === "terminada" ? "Terminada." : run?.status === "corriendo" ? "Sigue simulando: probá en un minuto." : "Avanzó: quedan charlas por puntuar.");
  } catch (e) {
    return fail(e);
  }
}

/** Guarda un caso de una corrida (por ejemplo, uno armado en «Jugar de paciente») para la batería. */
export async function labSaveCase(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  const run = await getRun(text(form, "corrida"));
  const snapshot = run?.cases.find((c) => c.id === text(form, "caso"));
  if (!run || !snapshot) return { ok: false, message: "No encontré ese caso." };
  try {
    await saveCase(clinic.id, snapshot, "panel", ACTOR);
    return done("Guardado: entra en la batería de cada noche.");
  } catch (e) {
    return fail(e);
  }
}

export async function labToggleCase(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  await sql`update lab_cases set active = not active where id = ${text(form, "caso")}`;
  return done("Listo.");
}

export async function labProposeFromResult(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  if (!labJudgeConfigured()) return { ok: false, message: LAB_SUBSCRIPTION_MESSAGE };
  try {
    const n = await proposeFromResult(text(form, "resultado"), ACTOR);
    return done(n ? `${n} mejora${n === 1 ? "" : "s"} nueva${n === 1 ? "" : "s"} en Mejoras.` : "Claude no encontró nada nuevo para proponer en esta charla.");
  } catch (e) {
    return fail(e);
  }
}

export async function labGenerateProposals(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  if (!labJudgeConfigured()) return { ok: false, message: LAB_SUBSCRIPTION_MESSAGE };
  try {
    const n = await generateProposals(clinic, { actor: ACTOR });
    return done(n ? `${n} mejora${n === 1 ? "" : "s"} nueva${n === 1 ? "" : "s"}. Las de prompt ya se están probando.` : "No hay fallas recientes para proponer (o ya están todas propuestas).");
  } catch (e) {
    return fail(e);
  }
}

export async function labApprove(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  try {
    return done(await approveProposal(text(form, "mejora"), ACTOR, { clinicConfirmed: form.get("confirmo") === "on" }));
  } catch (e) {
    return fail(e);
  }
}

export async function labReject(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  try {
    await rejectProposal(text(form, "mejora"), ACTOR, text(form, "motivo"));
    return done("Rechazada y guardada en Criterios: no se vuelve a proponer.");
  } catch (e) {
    return fail(e);
  }
}

export async function labRevert(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  try {
    return done(await revertProposal(text(form, "mejora"), ACTOR));
  } catch (e) {
    return fail(e);
  }
}

export async function labExperiment(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  try {
    const variantId = await startExperiment(text(form, "mejora"), ACTOR);
    const variant = await getRun(variantId);
    if (variant?.baseline_run_id) startNow(variant.baseline_run_id);
    startNow(variantId);
    return done("Experimento en marcha: la versión actual contra la variante, con los mismos casos (hasta 8). Tarda unos minutos y cuesta centavos.");
  } catch (e) {
    return fail(e);
  }
}

export async function labSettings(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  const usd = (key: string, fallback: number) => {
    const n = Number(text(form, key).replace(",", "."));
    return Number.isFinite(n) && n > 0 ? Math.min(100, Math.round(n * 100) / 100) : fallback;
  };
  const settings = {
    resumen_whatsapp: form.get("resumen_whatsapp") === "on",
    auto_a: form.get("auto_a") === "on",
    tope_corrida_usd: usd("tope_corrida_usd", 1),
    tope_dia_usd: usd("tope_dia_usd", 2),
  };
  await sql`
    update clinics set lab_enabled = ${form.get("lab_enabled") === "on"}, lab_settings = lab_settings || ${json(settings)}
    where id = ${clinic.id}`;
  return done("Guardado.");
}

export async function labAddCriterion(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  try {
    await addCriterion(text(form, "alcance") === "todas" ? null : clinic.id, text(form, "criterio"), ACTOR);
    return done("Guardado: el juez y Claude lo leen desde ahora.");
  } catch (e) {
    return fail(e);
  }
}

export async function labDeleteCriterion(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  await sql`delete from lab_criteria where id = ${text(form, "criterio")}`;
  return done("Borrado.");
}

/** Convierte una charla real (o de un tester) en un caso de la batería. */
export async function labCaseFromConversation(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  if (!labJudgeConfigured()) return { ok: false, message: LAB_SUBSCRIPTION_MESSAGE };
  const id = text(form, "conversacion");
  if (!isUuid(id)) return { ok: false, message: "Falta la charla." };
  const [row] = await sql<Array<{ transcript: unknown; summary: string | null; findings: Array<{ problema: string; cita: string }> | null }>>`
    select c.transcript, r.summary, r.findings from conversations c left join lab_reviews r on r.conversation_id = c.id
    where c.id = ${id} and c.clinic_id = ${clinic.id}`;
  if (!row) return { ok: false, message: "No encontré esa charla." };
  try {
    const findings = (row.findings ?? []).map((f) => `- ${f.problema}${f.cita ? ` («${f.cita}»)` : ""}`).join("\n");
    const labCase = await draftLabCase(
      clinic,
      `Convertí esta charla real en un caso que reproduzca la misma situación con datos ficticios (otro nombre, otro DNI). Las condiciones tienen que comprobar que Sofi no repita estos problemas:\n${findings || "(sin hallazgos: comprobá que lo haga igual de bien)"}\n\nCharla real:\n${transcriptText(storedTranscript(row.transcript), 12_000)}`,
    );
    await saveCase(clinic.id, labCase, "charla_real", ACTOR);
    return done(`Caso guardado: «${labCase.titulo}». Entra en la batería de esta noche; también lo podés correr en Jugar de paciente.`);
  } catch (e) {
    return fail(e);
  }
}

/** Arma casos para hasta 3 tipos de caso sin ninguno (primero los que aparecen en charlas reales). */
export async function labCoverageCases(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  if (!labJudgeConfigured()) return { ok: false, message: LAB_SUBSCRIPTION_MESSAGE };
  try {
    const titles = await fillCoverage(clinic, 3, 240_000);
    return done(titles.length ? `Casos nuevos: ${titles.map((t) => `«${t}»`).join(", ")}. Entran en la batería siguiente.` : "No falta ningún tipo de caso.");
  } catch (e) {
    return fail(e);
  }
}

/** Clave del laboratorio para Claude Code o ChatGPT: de lectura o para evaluar (suscripción). Se muestra una sola vez. */
export async function labCreateToken(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  const label = text(form, "etiqueta") || "Claude Code";
  const scope = text(form, "permiso") === "evaluar" ? "evaluar" : "lectura";
  const token = `lab_${randomBytes(24).toString("hex")}`;
  await sql`insert into lab_access_tokens (token_hash, label, created_by, scope) values (${createHash("sha256").update(token).digest("hex")}, ${label.slice(0, 80)}, ${ACTOR}, ${scope})`;
  revalidatePath("/panel/laboratorio/criterios");
  return { ok: true, message: `Clave (se ve solo ahora, copiala): ${token}` };
}

export async function labRevokeToken(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  await sql`update lab_access_tokens set revoked_at = now() where id = ${text(form, "clave")} and revoked_at is null`;
  return done("Clave revocada.");
}


/** Marca una charla como prueba (de alguien del equipo): sale del puntaje de charlas reales y de las métricas. */
export async function labMarkTest(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  const clinic = await adminClinic(form);
  const id = text(form, "conversacion");
  if (!isUuid(id)) return { ok: false, message: "Falta la charla." };
  const test = form.get("prueba") !== "no";
  await sql`update conversations set is_test = ${test} where id = ${id} and clinic_id = ${clinic.id}`;
  await sql`update lab_reviews set is_test = ${test} where conversation_id = ${id}`;
  return done(test ? "Marcada como prueba: ya no cuenta como charla real." : "Vuelve a contar como charla real.");
}

/** Arranca a simular apenas se crea la corrida, sin esperar al cron (que sigue después si no alcanza). */
function startNow(runId: string) {
  after(async () => {
    try {
      await advanceRun(runId, 240_000);
    } catch (e) {
      console.error("Laboratorio: no se pudo empezar la corrida al momento", e instanceof Error ? e.message : e);
    }
  });
}

/**
 * «Evaluar» sin clave ni API: el equipo pegó en el panel lo que respondió Claude o ChatGPT (la suscripción)
 * al pedido de la pestaña Evaluar. Se guarda igual que lo del skill: el servidor calcula el puntaje.
 */
export async function labApplySubscription(_prev: LabFormState, form: FormData): Promise<LabFormState> {
  await requireAdmin();
  const answer = text(form, "respuesta");
  if (!answer) return { ok: false, message: "Pegá la respuesta del chat." };
  const evaluador = text(form, "evaluador") === "ChatGPT" ? "ChatGPT" : "Claude";
  try {
    const { applyExternal, parseSubscriptionAnswer } = await import("@/lib/lab/external");
    const parsed = parseSubscriptionAnswer(answer) as Record<string, unknown>;
    const result = await applyExternal({ ...parsed, evaluador });
    revalidatePath("/panel/laboratorio", "layout");
    if (!result.ok) return { ok: false, message: `La respuesta no tiene el formato: ${result.errores.slice(0, 3).join(" · ")}` };
    const parts = [
      result.simulaciones && `${result.simulaciones} simulaciones`,
      result.charlas_reales && `${result.charlas_reales} charlas reales`,
      result.propuestas && `${result.propuestas} propuestas`,
    ].filter(Boolean);
    return done(`Cargado: ${parts.join(", ") || "nada nuevo"}${result.corridas_cerradas ? ` · ${result.corridas_cerradas} corrida${result.corridas_cerradas === 1 ? "" : "s"} cerrada${result.corridas_cerradas === 1 ? "" : "s"}` : ""}.${result.errores.length ? ` Avisos: ${result.errores.slice(0, 3).join(" · ")}` : ""} Si queda más, copiá el pedido nuevo.`);
  } catch (e) {
    return fail(e);
  }
}
