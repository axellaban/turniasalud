import "server-only";
import { json, sql } from "./db";
import { getClinic } from "./clinic";
import { AGENT_SOURCES } from "./clinic-impact";
import { registerOutbound } from "./channel";
import { requireActiveWhatsapp } from "./messaging-settings";
import { displayPhone } from "./phone";
import { humanSlot, localDateKey, zonedParts } from "./time";
import type { Clinic } from "./types";
import { chatIdForPhone, wahaSendText } from "./waha";
import { wahaConnectionForClinic, withClinicWaha } from "./waha-connections";

// Resumen diario de Sofi para el equipo (pedido del Dr. Mininni, 16/11). El consultorio lleva su
// agenda en otro sistema (Smile Connect) y ahí copia a mano los turnos que da Sofi; ese sistema no
// recibe por API ni la prestación ni notas, así que en su agenda el turno aparece «sin datos». Los
// días hábiles a las 10 (hora de la clínica), Sofi le manda por WhatsApp a los celulares del equipo
// lo que dio, movió y canceló desde el resumen anterior, con lo que hace falta para copiarlo. Y si
// en la agenda ven un turno sin datos, le preguntan a Sofi por WhatsApp (ver_agenda dice quién lo
// dio; detalle_turno da todo).

/** Hora (de la clínica) del resumen automático, de lunes a viernes. */
export const SUMMARY_HOUR = 10;
/** Turnos por sección en el WhatsApp; el resto, preguntándole a Sofi. */
const MAX_ITEMS = 40;
const SOFI = AGENT_SOURCES;

const VIA: Record<string, string> = {
  whatsapp: "por WhatsApp",
  telegram: "por Telegram",
  telefono: "por llamada",
  web: "por la web",
  campana: "al responder una campaña",
};

/** Quién dio el turno, en palabras («Sofi por WhatsApp», «el consultorio desde el panel»). */
export function givenBy(source: string, agentName: string): string {
  if (SOFI.includes(source)) return `${agentName} ${VIA[source] ?? ""}`.trim();
  if (source === "smile_connect") return "recepción (vino de Smile Connect)";
  if (source === "panel") return "el consultorio desde el panel";
  return source;
}

export type SummaryItem = {
  turno_id: string;
  cuando: string;
  profesional: string;
  prestacion: string;
  paciente: string;
  dni: string | null;
  celular: string | null;
  cobertura: string | null;
  notas: string | null;
  /** Quién lo dio y cuándo. */
  dio: string;
  paciente_nuevo: boolean;
  /** Movidos: dónde estaba antes. */
  antes?: string;
  /** Cancelados: el motivo, si lo dijo. */
  motivo?: string | null;
  /** Lo que se pega en la nota del turno del otro sistema. */
  nota: string;
};

export type DailySummary = { from: Date; to: Date; nuevos: SummaryItem[]; movidos: SummaryItem[]; cancelados: SummaryItem[] };

type Row = {
  id: string;
  starts_at: string;
  status: string;
  source: string;
  created_at: string;
  cancelled_at: string | null;
  cancelled_via: string | null;
  notes: string | null;
  coverage: string | null;
  /** El turno que este reemplazó al reprogramar (el viejo apunta al nuevo con replaced_by). */
  previous_id: string | null;
  type_name: string;
  professional: string;
  full_name: string | null;
  dni: string | null;
  phone: string | null;
  patient_coverage: string | null;
  coverage_plan: string | null;
  member_number: string | null;
  patient_created_at: string;
};

type Ancestor = { leaf: string; id: string; created_at: string; source: string; starts_at: string; professional: string; cancelled_via: string | null; depth: number };

/** Las notas sin lo que agrega la cancelación («… | Cancelado: motivo»). */
function splitNotes(notes: string | null): { notes: string | null; reason: string | null } {
  if (!notes) return { notes: null, reason: null };
  const parts = notes.split(" | ");
  const cancel = parts.filter((p) => p.startsWith("Cancelado: "));
  const rest = parts.filter((p) => !p.startsWith("Cancelado: ")).join(" | ").trim();
  return { notes: rest || null, reason: cancel.length ? cancel[cancel.length - 1].slice("Cancelado: ".length) : null };
}

function coverageText(r: Pick<Row, "coverage" | "patient_coverage" | "coverage_plan" | "member_number">): string | null {
  const name = r.coverage ?? r.patient_coverage;
  if (!name) return null;
  const samePlan = r.coverage_plan && (!r.coverage || r.coverage === r.patient_coverage);
  return [name, samePlan ? r.coverage_plan : null, r.member_number && samePlan ? `afiliado ${r.member_number}` : null].filter(Boolean).join(" ");
}

function toItem(r: Row, clinic: Clinic, from: Date | null): SummaryItem {
  const { notes, reason } = splitNotes(r.notes);
  const by = givenBy(r.source, clinic.agent_name);
  const coverage = coverageText(r);
  return {
    turno_id: r.id,
    cuando: humanSlot(new Date(r.starts_at), clinic.timezone),
    profesional: r.professional,
    prestacion: r.type_name,
    paciente: r.full_name ?? "Paciente sin nombre",
    dni: r.dni,
    celular: r.phone ? displayPhone(r.phone) : null,
    cobertura: coverage,
    notas: notes,
    dio: `${by}, el ${humanSlot(new Date(r.created_at), clinic.timezone)}`,
    paciente_nuevo: from ? new Date(r.patient_created_at) >= from : false,
    motivo: reason,
    nota: [r.type_name, coverage ?? "sin cobertura cargada", notes && `«${notes}»`, `Dio ${by}`].filter(Boolean).join(" · "),
  };
}

const rowColumns = () => sql`
  a.id, a.starts_at, a.status, a.source, a.created_at, a.cancelled_at, a.cancelled_via, a.notes, a.coverage,
  (select prev.id from appointments prev where prev.replaced_by = a.id limit 1) as previous_id,
  coalesce(a.title, t.name) as type_name, pr.full_name || coalesce(' y ' || p2.full_name, '') as professional,
  p.full_name, p.dni, p.phone, p.coverage as patient_coverage, p.coverage_plan, p.member_number, p.created_at as patient_created_at`;
const rowJoins = () => sql`
  join patients p on p.id = a.patient_id
  join appointment_types t on t.id = a.appointment_type_id
  join professionals pr on pr.id = a.professional_id
  left join professionals p2 on p2.id = a.second_professional_id`;

/** Lo que hizo Sofi entre `from` y `to`: turnos nuevos, movidos y cancelados. */
export async function buildSummary(clinic: Clinic, from: Date, to: Date): Promise<DailySummary> {
  const rows = await sql<Row[]>`
    select ${rowColumns()} from appointments a ${rowJoins()}
    where a.clinic_id = ${clinic.id} and (
      (a.created_at >= ${from} and a.created_at < ${to} and a.status not in ('cancelado', 'reprogramado')
        and (a.source = any(${SOFI}::text[])
          -- El equipo que mueve por WhatsApp conserva el origen del turno: cuenta por quién lo movió.
          or exists (select 1 from appointments prev where prev.replaced_by = a.id and prev.cancelled_via = any(${SOFI}::text[]))))
      or (a.status = 'cancelado' and a.cancelled_at >= ${from} and a.cancelled_at < ${to} and a.cancelled_via = any(${SOFI}::text[]))
    )
    order by a.starts_at`;
  // Al mover un turno se crea otro (el viejo apunta al nuevo con replaced_by): la cadena dice qué conocía el consultorio.
  const moved = rows.filter((r) => r.previous_id && r.status !== "cancelado").map((r) => r.id);
  const chain = moved.length
    ? await sql<Ancestor[]>`
        with recursive c as (
          select a.id as leaf, a.id as cur, 0 as depth from appointments a where a.id = any(${moved}::uuid[])
          union all
          select c.leaf, prev.id, c.depth + 1 from c join appointments prev on prev.replaced_by = c.cur where c.depth < 30
        )
        select c.leaf, a.id, a.created_at, a.source, a.starts_at, a.cancelled_via, c.depth,
          pr.full_name as professional
        from c join appointments a on a.id = c.cur join professionals pr on pr.id = a.professional_id
        where c.depth > 0
        order by c.leaf, c.depth`
    : [];

  const summary: DailySummary = { from, to, nuevos: [], movidos: [], cancelados: [] };
  for (const r of rows) {
    const item = toItem(r, clinic, from);
    if (r.status === "cancelado") {
      summary.cancelados.push(item);
      continue;
    }
    if (!r.previous_id) {
      summary.nuevos.push(item);
      continue;
    }
    // Del más cercano al más viejo.
    const ancestors = chain.filter((a) => a.leaf === r.id);
    const knownAt = ancestors.findIndex((a) => new Date(a.created_at) < from);
    if (knownAt === -1) {
      // Todo pasó después del resumen anterior: si lo dio Sofi, es nuevo (con su horario de ahora).
      const root = ancestors[ancestors.length - 1];
      if (!root || SOFI.includes(root.source)) summary.nuevos.push(item);
      else if (ancestors.some((a) => a.cancelled_via && SOFI.includes(a.cancelled_via))) summary.movidos.push({ ...item, antes: `${humanSlot(new Date(root.starts_at), clinic.timezone)} con ${root.professional}` });
      continue;
    }
    // El consultorio conocía el turno en `known`: cuenta si Sofi lo movió desde ahí.
    const known = ancestors[knownAt];
    if (ancestors.slice(0, knownAt + 1).some((a) => a.cancelled_via && SOFI.includes(a.cancelled_via))) {
      summary.movidos.push({ ...item, antes: `${humanSlot(new Date(known.starts_at), clinic.timezone)} con ${known.professional}` });
    }
  }
  return summary;
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function itemLines(item: SummaryItem, n: number, kind: "nuevo" | "movido" | "cancelado"): string {
  const who = [item.paciente + (item.paciente_nuevo ? " (paciente nuevo)" : ""), item.dni && `DNI ${item.dni}`, item.celular].filter(Boolean).join(" · ");
  const head = kind === "movido" ? `${n}. *${capitalize(item.cuando)}* · ${item.profesional} (antes: ${item.antes})` : `${n}. *${capitalize(item.cuando)}* · ${item.profesional}`;
  if (kind === "cancelado") return [head, who, `${item.prestacion}${item.motivo ? ` · motivo: ${item.motivo}` : ""}`].join("\n");
  return [head, who, `Nota: ${item.nota}`].join("\n");
}

function section(title: string, items: SummaryItem[], kind: "nuevo" | "movido" | "cancelado"): string | null {
  if (!items.length) return null;
  const shown = items.slice(0, MAX_ITEMS).map((it, i) => itemLines(it, i + 1, kind));
  const more = items.length > MAX_ITEMS ? `\n…y ${items.length - MAX_ITEMS} más: pedímelos por acá.` : "";
  return `*${title} (${items.length})*\n\n${shown.join("\n\n")}${more}`;
}

/** El WhatsApp del resumen. */
export function summaryText(summary: DailySummary, clinic: Clinic): string {
  const since = humanSlot(summary.from, clinic.timezone);
  const { nuevos, movidos, cancelados } = summary;
  const ask = `Si en la agenda ves un turno sin datos, preguntame por acá (por ejemplo: «¿el turno del martes a las 11:30 lo diste vos?») y te paso el detalle.`;
  if (!nuevos.length && !movidos.length && !cancelados.length) {
    return `Buen día. Soy ${clinic.agent_name}: desde el ${since} no di, moví ni cancelé turnos.\n\n${ask}`;
  }
  const counts = [
    nuevos.length && `${nuevos.length} ${nuevos.length === 1 ? "turno nuevo" : "turnos nuevos"}`,
    movidos.length && `${movidos.length} ${movidos.length === 1 ? "movido" : "movidos"}`,
    cancelados.length && `${cancelados.length} ${cancelados.length === 1 ? "cancelado" : "cancelados"}`,
  ].filter(Boolean);
  const list = counts.length > 1 ? `${counts.slice(0, -1).join(", ")} y ${counts[counts.length - 1]}` : counts[0];
  return [
    `Buen día. Soy ${clinic.agent_name}. Desde el ${since}: ${list}. Para pasarlos a la agenda, la «Nota» de cada uno trae la prestación, la cobertura y lo que pidió.`,
    section("Turnos nuevos", nuevos, "nuevo"),
    section("Turnos movidos", movidos, "movido"),
    section("Turnos cancelados", cancelados, "cancelado"),
    ask,
  ].filter(Boolean).join("\n\n");
}

/** Desde cuándo va el próximo resumen: donde terminó el anterior (hasta 7 días atrás). */
async function windowStart(clinic: Clinic, now: Date): Promise<Date> {
  const [last] = await sql<Array<{ window_to: Date }>>`
    select window_to from clinic_daily_summaries where clinic_id = ${clinic.id} and recipients > 0 order by window_to desc limit 1`;
  const week = new Date(now.getTime() - 7 * 86400_000);
  if (last) return new Date(Math.max(new Date(last.window_to).getTime(), week.getTime()));
  // El primero: desde el día hábil anterior a esta hora (el lunes, desde el viernes).
  const weekday = zonedParts(now, clinic.timezone).weekday;
  return new Date(now.getTime() - (weekday === 1 ? 3 : 1) * 86400_000);
}

export type SendResult = { clinic: string; enviados: number; turnos: { nuevos: number; movidos: number; cancelados: number }; problema?: string };

/** Le manda el resumen a los celulares del equipo que lo reciben, por la línea de WhatsApp del consultorio. */
async function deliver(clinic: Clinic, summary: DailySummary): Promise<{ sent: number; problem?: string }> {
  const staff = await sql<Array<{ phone: string; name: string }>>`
    select phone, name from clinic_staff_phones where clinic_id = ${clinic.id} and daily_summary order by created_at`;
  if (!staff.length) return { sent: 0, problem: "Nadie del equipo recibe el resumen (Configuración → Consultorio → Acceso total por WhatsApp)." };
  if (clinic.is_demo) return { sent: 0, problem: "Es una demo: no se manda." };
  if (!wahaConnectionForClinic(clinic.id) && clinic.whatsapp_provider !== "waha") {
    return { sent: 0, problem: "El resumen sale por WAHA (la línea propia del consultorio), y este consultorio no la tiene." };
  }
  const text = summaryText(summary, clinic);
  let sent = 0;
  let problem: string | undefined;
  await withClinicWaha(clinic.id, async () => {
    try {
      await requireActiveWhatsapp();
    } catch {
      problem = "El WhatsApp del consultorio está pausado.";
      return;
    }
    for (const member of staff) {
      try {
        const chatId = chatIdForPhone(member.phone);
        await wahaSendText(chatId, text);
        // Si contesta («¿y el de las 11:30?»), Sofi sabe qué le mandó.
        await registerOutbound(clinic.id, {
          phone: member.phone,
          chatId,
          text,
          context: `Le mandaste a ${member.name} (equipo del consultorio) el resumen diario de los turnos que diste, moviste y cancelaste. Si pregunta por uno, usá detalle_turno o ver_agenda.`,
        });
        sent++;
      } catch (e) {
        problem = `No se pudo mandar a ${member.name}: ${e instanceof Error ? e.message.slice(0, 160) : String(e)}`;
        console.error("Resumen diario de Sofi", clinic.id, e);
      }
    }
  });
  return { sent, problem };
}

const countsOf = (s: DailySummary) => ({ nuevos: s.nuevos.length, movidos: s.movidos.length, cancelados: s.cancelados.length });

/**
 * Los resúmenes que tocan ahora: días hábiles desde las 10 (hora de cada clínica), uno por día. Se
 * llama desde el disparador de cada 10 minutos (`/api/automations/calendario`) y desde la tarea diaria
 * de Chapa Labs; el primero que llega lo manda y el resto ve que ya salió.
 */
export async function sendDueSummaries(now = new Date()): Promise<SendResult[]> {
  const clinics = await sql<Array<{ id: string }>>`
    select distinct c.id from clinics c join clinic_staff_phones s on s.clinic_id = c.id and s.daily_summary
    where not c.is_demo`;
  const results: SendResult[] = [];
  for (const { id } of clinics) {
    const clinic = await getClinic(id);
    const local = zonedParts(now, clinic.timezone);
    if (local.weekday === 0 || local.weekday === 6 || local.hour < SUMMARY_HOUR) continue;
    const day = localDateKey(now, clinic.timezone);
    const from = await windowStart(clinic, now);
    // Se reserva el día antes de mandar: dos disparadores juntos no lo mandan dos veces.
    const [claim] = await sql<Array<{ id: string }>>`
      insert into clinic_daily_summaries (clinic_id, day, window_from, window_to) values (${clinic.id}, ${day}, ${from}, ${now})
      on conflict (clinic_id, day) where day is not null do nothing returning id`;
    if (!claim) continue;
    try {
      const summary = await buildSummary(clinic, from, now);
      const { sent, problem } = await deliver(clinic, summary);
      if (!sent) {
        // Nada salió: se libera el día para reintentar en la próxima corrida.
        await sql`delete from clinic_daily_summaries where id = ${claim.id}`;
      } else {
        await sql`update clinic_daily_summaries set recipients = ${sent}, counts = ${json(countsOf(summary))} where id = ${claim.id}`;
      }
      results.push({ clinic: clinic.name, enviados: sent, turnos: countsOf(summary), ...(problem && { problema: problem }) });
    } catch (e) {
      await sql`delete from clinic_daily_summaries where id = ${claim.id}`;
      throw e;
    }
  }
  return results;
}

/** Panel: «Mandar el resumen ahora» (para probarlo o si hace falta antes de las 10). No cuenta como el del día. */
export async function sendSummaryNow(clinicId: string, now = new Date()): Promise<SendResult> {
  const clinic = await getClinic(clinicId);
  const from = await windowStart(clinic, now);
  const summary = await buildSummary(clinic, from, now);
  const { sent, problem } = await deliver(clinic, summary);
  if (sent) {
    await sql`
      insert into clinic_daily_summaries (clinic_id, day, window_from, window_to, recipients, counts)
      values (${clinic.id}, null, ${from}, ${now}, ${sent}, ${json(countsOf(summary))})`;
  }
  return { clinic: clinic.name, enviados: sent, turnos: countsOf(summary), ...(problem && { problema: problem }) };
}

/** Lo que diste desde una fecha (herramienta de Sofi para el equipo). */
export async function summarySince(clinicId: string, from: Date, to = new Date()): Promise<DailySummary & { clinic: Clinic }> {
  const clinic = await getClinic(clinicId);
  return { ...(await buildSummary(clinic, from, to)), clinic };
}

/** Un turno con todo lo que hace falta para cargarlo en otro sistema (herramienta detalle_turno). */
export async function appointmentDetail(clinic: Clinic, appointmentId: string) {
  const [r] = await sql<Row[]>`select ${rowColumns()} from appointments a ${rowJoins()} where a.id = ${appointmentId} and a.clinic_id = ${clinic.id}`;
  if (!r) return null;
  const item = toItem(r, clinic, null);
  // La charla en la que lo pidió (la más cercana antes de darlo), si quedó guardada.
  const [talk] = SOFI.includes(r.source)
    ? await sql<Array<{ summary: string | null; title: string | null; started_at: string }>>`
        select summary, title, started_at from conversations
        where clinic_id = ${clinic.id} and patient_id = (select patient_id from appointments where id = ${r.id})
          and started_at <= ${new Date(new Date(r.created_at).getTime() + 10 * 60_000)} and started_at >= ${new Date(new Date(r.created_at).getTime() - 6 * 3600_000)}
        order by started_at desc limit 1`
    : [];
  const [previous] = r.previous_id
    ? await sql<Array<{ starts_at: string; professional: string; cancelled_via: string | null }>>`
        select a.starts_at, pr.full_name as professional, a.cancelled_via from appointments a join professionals pr on pr.id = a.professional_id where a.id = ${r.previous_id}`
    : [];
  return {
    ...item,
    estado: r.status,
    ...(previous && {
      antes: `${humanSlot(new Date(previous.starts_at), clinic.timezone)} con ${previous.professional}${previous.cancelled_via ? `; lo movió ${givenBy(previous.cancelled_via, clinic.agent_name)}` : ""}`,
    }),
    ...(talk && { conversacion: [talk.title, talk.summary].filter(Boolean).join(": ").slice(0, 900) || null }),
  };
}
