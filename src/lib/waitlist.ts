import "server-only";
import { sql } from "./db";
import { getCatalog, getClinic } from "./clinic";
import { displayPhone } from "./phone";
import { humanSlot, localDateKey, parseDateKey, zonedTimeToUtc } from "./time";
import { ToolError } from "./agent/service";

function dayStart(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, 0, 0, timeZone);
}

/** Lee la lista vigente en cada consulta del equipo; no usa el contexto de una charla anterior. */
export type WaitlistFilters = {
  desde?: string; profesional_id?: string; estado?: "pendientes" | "activa" | "ofrecida" | "resuelta" | "cancelada" | "todas"; pagina?: number;
};

/** Los llamadores autorizan al equipo por WhatsApp o a la sesión del panel antes de leer. */
export async function readWaitlist(clinicId: string, input: WaitlistFilters = {}) {
  const clinic = await getClinic(clinicId);
  const now = new Date();
  const from = input.desde ? parseDateKey(input.desde) : null;
  if (input.desde && !from) throw new ToolError("Revisá la fecha desde (AAAA-MM-DD).");
  if (input.profesional_id && !(await getCatalog(clinic.id)).professionals.some((p) => p.id === input.profesional_id)) {
    throw new ToolError("Profesional inválido.");
  }
  const status = input.estado ?? "pendientes";
  const page = input.pagina ?? 1;
  const pageSize = 30;
  type Entry = {
    id: string; patient_id: string; patient: string | null; phone: string | null;
    type_name: string | null; professional: string | null; preferences: string | null;
    status: string; created_at: string; offered_at: string | null;
    appointment_id: string | null; starts_at: string | null; appointment_status: string | null;
  };
  const [result] = await sql<Array<{ total: number; entries: Entry[] }>>`
    with matched as (
      select w.id, w.patient_id, p.full_name as patient, p.phone,
        coalesce(a.title, t.name) as type_name, coalesce(pr.full_name, current_pr.full_name) as professional,
        w.preferences, w.status, w.created_at, w.offered_at, w.appointment_id, a.starts_at, a.status as appointment_status
      from waitlist w
      join patients p on p.id = w.patient_id and p.clinic_id = w.clinic_id
      left join appointment_types t on t.id = w.appointment_type_id and t.clinic_id = w.clinic_id
      left join professionals pr on pr.id = w.professional_id and pr.clinic_id = w.clinic_id
      left join appointments a on a.id = w.appointment_id and a.clinic_id = w.clinic_id and a.patient_id = w.patient_id
      left join professionals current_pr on current_pr.id = a.professional_id and current_pr.clinic_id = w.clinic_id
      where w.clinic_id = ${clinic.id}
        ${status === "pendientes" ? sql`and w.status in ('activa', 'ofrecida')` : status === "todas" ? sql`` : sql`and w.status = ${status}`}
        ${["pendientes", "activa", "ofrecida"].includes(status) ? sql`and (w.appointment_id is null or (a.status = 'confirmado' and a.starts_at > ${now}))` : sql``}
        ${from ? sql`and w.created_at >= ${dayStart(from, clinic.timezone)}` : sql``}
        ${input.profesional_id ? sql`and coalesce(w.professional_id, a.professional_id) = ${input.profesional_id}` : sql``}
    ), page as (select * from matched order by created_at, id limit ${pageSize} offset ${(page - 1) * pageSize})
    select (select count(*)::int from matched) as total,
      coalesce((select jsonb_agg(to_jsonb(page) order by created_at, id) from page), '[]'::jsonb) as entries`;
  return {
    ok: true,
    actualizada_a: now.toISOString(),
    desde: from,
    estado: status,
    total: result.total,
    pagina: page,
    siguiente_pagina: page * pageSize < result.total ? page + 1 : null,
    pacientes: result.entries.map((r) => ({
      espera_id: r.id, paciente_id: r.patient_id, paciente: r.patient ?? "Sin nombre",
      celular: displayPhone(r.phone), prestacion: r.type_name ?? "Sin prestación",
      profesional: r.professional ?? "Sin preferencia de profesional", preferencias: r.preferences ?? "Sin preferencias registradas",
      estado: r.status, anotado: humanSlot(new Date(r.created_at), clinic.timezone),
      anotado_hoy: localDateKey(new Date(r.created_at), clinic.timezone) === localDateKey(now, clinic.timezone),
      ultimo_ofrecimiento: r.offered_at ? humanSlot(new Date(r.offered_at), clinic.timezone) : null,
      turno_actual: r.appointment_id ? { turno_id: r.appointment_id, cuando: r.starts_at ? humanSlot(new Date(r.starts_at), clinic.timezone) : null, estado: r.appointment_status } : null,
    })),
    mensaje: result.total
      ? "Lista leída ahora de Turnia. Incluye las altas de hoy. Activa: espera una oferta; ofrecida: ya se le avisó y falta resolver. Respetá sus preferencias. Si hay siguiente_pagina, consultala para completar la lista. No confirmes inscripciones que solo se propusieron y el paciente no aceptó."
      : "No hay pacientes registrados en esta lista con esos filtros. No significa que no haya propuestas pendientes de aceptación en las conversaciones.",
  };
}

