import "server-only";
import { sql } from "./db";
import { getCatalog, getClinic } from "./clinic";
import { displayPhone } from "./phone";
import { humanSlot, localDateKey, parseDateKey, zonedTimeToUtc } from "./time";
import { ToolError } from "./agent/service";
import { CONSULTATION_CATEGORIES, type ConsultationCategory } from './consultation-reason';

function dayStart(key: string, timeZone: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return zonedTimeToUtc(y, m, d, 0, 0, timeZone);
}

/** Lee la lista vigente en cada consulta del equipo; no usa el contexto de una charla anterior. */
export type WaitlistFilters = {
  desde?: string; profesional_id?: string; estado?: "pendientes" | "activa" | "ofrecida" | "resuelta" | "cancelada" | "todas"; pagina?: number;
  motivo?: ConsultationCategory; prioridad?: 'alta' | 'normal'; con_turno?: boolean;
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
  if (!Number.isInteger(page) || page < 1 || page > 10000) throw new ToolError('Página inválida.');
  if (input.motivo && !CONSULTATION_CATEGORIES.includes(input.motivo)) throw new ToolError('Motivo inválido.');
  const pageSize = 30;
  type Entry = {
    id: string; patient_id: string; patient: string | null; phone: string | null;
    type_name: string | null; professional: string | null; preferences: string | null;
    status: string; created_at: string; offered_at: string | null;
    appointment_id: string | null; starts_at: string | null; appointment_status: string | null;
    reason: string | null; categories: ConsultationCategory[]; high_priority: boolean; origin: 'espera' | 'motivo';
    notes_pending: boolean; notes_error: string | null;
  };
  const [result] = await sql<Array<{ total: number; entries: Entry[] }>>`
    with combined as (
      select w.id, w.patient_id, p.full_name as patient, p.phone,
        coalesce(a.title, t.name) as type_name, coalesce(pr.full_name, current_pr.full_name) as professional,
        w.preferences, w.status, w.created_at, w.offered_at, a.id as appointment_id, a.starts_at, a.status as appointment_status,
        coalesce(w.consultation_reason, a.consultation_reason) as reason,
        case when w.consultation_reason is not null then w.consultation_categories else coalesce(a.consultation_categories, '{}') end as categories,
        coalesce(coalesce(w.patient_first_visit, a.patient_first_visit) and
          (case when w.consultation_reason is not null then w.consultation_categories else coalesce(a.consultation_categories, '{}') end)
          && array['implantes', 'protesis', 'blanqueamiento'], false) as high_priority,
        'espera'::text as origin, coalesce(a.smile_booking_notes_pending, false) as notes_pending, a.smile_booking_notes_error as notes_error
      from waitlist w
      join patients p on p.id = w.patient_id and p.clinic_id = w.clinic_id
      left join appointment_types t on t.id = w.appointment_type_id and t.clinic_id = w.clinic_id
      left join professionals pr on pr.id = w.professional_id and pr.clinic_id = w.clinic_id
      left join lateral (select a.* from appointments a where a.clinic_id = w.clinic_id and a.patient_id = w.patient_id
        and (a.id = w.appointment_id or (w.appointment_id is null and a.status = 'confirmado' and a.starts_at > ${now}))
        order by a.starts_at limit 1) a on true
      left join professionals current_pr on current_pr.id = a.professional_id and current_pr.clinic_id = w.clinic_id
      where w.clinic_id = ${clinic.id}
        ${status === "pendientes" ? sql`and w.status in ('activa', 'ofrecida')` : status === "todas" ? sql`` : sql`and w.status = ${status}`}
        ${["pendientes", "activa", "ofrecida"].includes(status) ? sql`and (w.appointment_id is null or (a.status = 'confirmado' and a.starts_at > ${now}))` : sql``}
        ${from ? sql`and w.created_at >= ${dayStart(from, clinic.timezone)}` : sql``}
        ${input.profesional_id ? sql`and coalesce(w.professional_id, a.professional_id) = ${input.profesional_id}` : sql``}
      union all
      select a.id, a.patient_id, p.full_name, p.phone, coalesce(a.title, t.name), pr.full_name,
        null::text, 'candidato'::text, a.created_at, null::timestamptz, a.id, a.starts_at, a.status,
        a.consultation_reason, a.consultation_categories, true, 'motivo'::text,
        a.smile_booking_notes_pending, a.smile_booking_notes_error
      from appointments a join patients p on p.id = a.patient_id and p.clinic_id = a.clinic_id
      join appointment_types t on t.id = a.appointment_type_id and t.clinic_id = a.clinic_id
      join professionals pr on pr.id = a.professional_id and pr.clinic_id = a.clinic_id
      where ${Boolean(clinic.collect_visit_reason)} and ${['pendientes', 'todas'].includes(status)}
        and a.clinic_id = ${clinic.id} and a.status = 'confirmado' and a.starts_at > ${now}
        and a.smile_management is null and (a.smile_sync is null or a.smile_sync = 'ok')
        and a.patient_first_visit = true and a.consultation_reason is not null
        and a.consultation_categories && array['implantes', 'protesis', 'blanqueamiento']
        and not exists (select 1 from waitlist w where w.clinic_id = a.clinic_id and w.patient_id = a.patient_id
          and w.status in ('activa', 'ofrecida') and (w.appointment_id = a.id or w.appointment_id is null))
        ${from ? sql`and a.created_at >= ${dayStart(from, clinic.timezone)}` : sql``}
        ${input.profesional_id ? sql`and a.professional_id = ${input.profesional_id}` : sql``}
    ), matched as (select * from combined where true
      ${input.motivo ? sql`and ${input.motivo} = any(categories)` : sql``}
      ${input.prioridad ? sql`and high_priority = ${input.prioridad === 'alta'}` : sql``}
      ${input.con_turno !== undefined ? sql`and (appointment_id is not null and appointment_status = 'confirmado' and starts_at > ${now}) = ${input.con_turno}` : sql``}
    ), page as (select * from matched order by high_priority desc, created_at, id limit ${pageSize} offset ${(page - 1) * pageSize})
    select (select count(*)::int from matched) as total,
      coalesce((select jsonb_agg(to_jsonb(page) order by high_priority desc, created_at, id) from page), '[]'::jsonb) as entries`;
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
      motivo: r.reason, categorias: r.categories, prioridad: r.high_priority ? 'alta' as const : 'normal' as const,
      inscripcion_confirmada: r.origin === 'espera',
      con_turno: Boolean(r.appointment_id && r.appointment_status === 'confirmado' && r.starts_at && Date.parse(r.starts_at) > now.getTime()),
      nota_smile_pendiente: r.notes_pending, nota_smile_error: r.notes_error,
      anotado_hoy: localDateKey(new Date(r.created_at), clinic.timezone) === localDateKey(now, clinic.timezone),
      ultimo_ofrecimiento: r.offered_at ? humanSlot(new Date(r.offered_at), clinic.timezone) : null,
      turno_actual: r.appointment_id ? { turno_id: r.appointment_id, cuando: r.starts_at ? humanSlot(new Date(r.starts_at), clinic.timezone) : null, estado: r.appointment_status } : null,
    })),
    mensaje: result.total
      ? "Lista leída ahora de Turnia. Incluye las altas de hoy. Activa: espera una oferta; ofrecida: ya se le avisó. Candidato: primera consulta destacada por motivo, no aceptó recibir avisos. Prioridad alta de seguimiento: primera consulta de implantes, prótesis o blanqueamiento; no es urgencia clínica. El equipo elige a quién contactar; no se envían mensajes ni se inscribe automáticamente. Respetá preferencias y conservá el turno actual hasta que acepte y se confirme el cambio. Si hay siguiente_pagina, consultala."
      : "No hay pacientes registrados en esta lista con esos filtros. No significa que no haya propuestas pendientes de aceptación en las conversaciones.",
  };
}

