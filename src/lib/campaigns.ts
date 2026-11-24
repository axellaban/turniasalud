import "server-only";
import { sql } from "./db";
import { getClinic } from "./clinic";
import { pauseBetweenSends, renderTemplate, sendPatientMessage, templateKeyFor, whatsappReadiness, withOptOutFooter } from "./whatsapp";
import { humanSlot, localDateKey } from "./time";
import { DEFAULT_FOLLOWUP_DAYS, inSendWindow, lineUsage, recordCampaignMessage } from "./campaign-limits";
import { describeRules, parseRules, type AudienceRules } from "./audience-rules";
import { ATTRIBUTION_DAYS, AUTO_CAMPAIGN_TYPES, type AutoCampaignType, type Campaign, type CampaignType, type Clinic } from "./types";

// "Activa": campañas salientes por WhatsApp. Cada destinatario recibe un
// template aprobado por Meta (o el mismo texto por WAHA) y, si responde, lo
// atiende el mismo agente con el contexto de la campaña. Quien pidió la baja (contact_opt_out) solo recibe
// los recordatorios de sus turnos y los avisos de la lista de espera.
//
// La base sale de dos lados: los turnos atendidos en Turnia y las visitas que la clínica trae de su
// sistema anterior (patient_visits, desde Pacientes → Importar). Al crear una campaña su audiencia
// queda guardada (campaign_recipients en «pendiente»): el equipo la revisa, quita a quien no
// corresponde y recién ahí envía.

export const CAMPAIGN_LABELS: Record<CampaignType, { label: string; title: string; description: string; goal: string }> = {
  recall: {
    label: "Recall de controles",
    title: "Controles vencidos",
    description: "Pacientes con un control periódico vencido (limpieza, lunares, chequeo anual…) o con un control indicado que ya llegó.",
    goal: "Que el paciente reserve su control periódico.",
  },
  reactivacion: {
    label: "Reactivación",
    title: "Pacientes inactivos",
    description: "Pacientes que no vienen hace tiempo y no tienen turnos futuros.",
    goal: "Que el paciente vuelva a atenderse y reserve un turno.",
  },
  recordatorio: {
    label: "Recordatorio de turno",
    title: "Turnos de mañana",
    description: "Turnos de mañana: confirmar asistencia o reprogramar.",
    goal: "Que el paciente confirme que viene, o reprograme/cancele si no puede.",
  },
  no_show: {
    label: "Recupero de ausentes",
    title: "Faltaron y no volvieron",
    description: "Pacientes que faltaron en los últimos 30 días y no volvieron a sacar turno.",
    goal: "Que el paciente reprograme el turno al que faltó.",
  },
  lista_espera: {
    label: "Lista de espera",
    title: "En lista de espera",
    description: "Pacientes anotados en la lista de espera activa.",
    goal: "Ofrecerle los turnos disponibles más cercanos.",
  },
  encuesta: {
    label: "Encuesta post-consulta",
    title: "Atendidos estos días",
    description: "Pacientes atendidos en los últimos 2 días: puntaje del 0 al 10 y comentarios.",
    goal: "Que el paciente responda del 0 al 10 si recomendaría la clínica y cuente cómo fue su atención.",
  },
  audiencia: {
    label: "Audiencia propia",
    title: "Audiencia propia",
    description: "Pacientes que cumplen las reglas que armó el equipo.",
    goal: "Que el paciente vuelva a atenderse y reserve un turno.",
  },
  personalizada: {
    label: "Aviso a todos",
    title: "Aviso a todos",
    description: "Todos los pacientes con WhatsApp. Útil para avisos (ej. cambio de horario).",
    goal: "Informar el aviso y resolver dudas.",
  },
};

/** La regla con la que se arma cada audiencia, con los valores de la clínica. */
export function campaignRule(type: CampaignType, clinic: Pick<Clinic, "reactivation_months">): string {
  if (type === "reactivacion") return `Sin venir hace más de ${clinic.reactivation_months} meses y sin turnos futuros.`;
  if (type === "recall") return "Según la frecuencia de cada prestación y los controles indicados a cada paciente.";
  return CAMPAIGN_LABELS[type].description;
}

/** Campañas para que el paciente vuelva a sacar turno: comparten el tope de contacto de la clínica. */
export const ACTIVATION_TYPES: readonly CampaignType[] = ["recall", "reactivacion", "no_show", "audiencia"];

export type AudienceMember = {
  patient_id: string;
  /** null: la ficha no tiene celular (figura en la lista, pero no se le puede escribir). */
  phone: string | null;
  name: string | null;
  detail: string;
  context: string;
  /** Precio de referencia del turno que se le ofrece (null si no hay precio cargado). */
  value: number | null;
  /** Prestación del turno que se le ofrece, si se sabe. */
  appointment_type_id?: string | null;
  /** Tiene un celular al que se le puede escribir por WhatsApp. */
  reachable: boolean;
};

const MAX_PER_RUN = 50;
const isWhatsAppId = (phone: string | null): phone is string => Boolean(phone) && /^\d{8,15}$/.test(phone!);
const price = (value: string | number | null | undefined) => (value === null || value === undefined || value === "" ? null : Number(value));

/** Motivos por los que un destinatario guardado no se envía (quedan a la vista en la campaña). */
export const NOT_REACHABLE = "No tiene un celular que sirva para WhatsApp.";
export const NO_LONGER_ELIGIBLE = "Ya no corresponde: sacó turno, pidió la baja o recibió otra campaña hace poco.";

type PatientRow = { id: string; full_name: string | null; phone: string | null };

type VisitRow = { id: string; starts_at: string; ends_at: string; professional_id: string; professional: string; type_name: string; patient: PatientRow };

const sumPrices = (values: Array<number | null>) => {
  const known = values.filter((v): v is number => v !== null);
  return known.length ? known.reduce((a, b) => a + b, 0) : null;
};

/**
 * Junta en una visita los turnos seguidos del mismo paciente con el mismo profesional (control y
 * limpieza): uno empieza cuando termina el anterior. Las filas tienen que venir ordenadas por inicio.
 */
export function groupVisits<T extends Pick<VisitRow, "starts_at" | "ends_at" | "professional_id"> & { patient: { id: string } }>(rows: T[]): T[][] {
  const visits: T[][] = [];
  for (const row of rows) {
    const visit = visits.find((v) => {
      const last = v[v.length - 1];
      return last.patient.id === row.patient.id && last.professional_id === row.professional_id && new Date(last.ends_at).getTime() === new Date(row.starts_at).getTime();
    });
    if (visit) visit.push(row);
    else visits.push([row]);
  }
  return visits;
}

/** Los turnos que nombra el contexto de un mensaje (una visita puede tener dos). */
export const appointmentIdsIn = (context: string | null | undefined) => [...(context ?? "").matchAll(/turno_id=([0-9a-f-]{36})/g)].map((m) => m[1]);

/** Recordatorio o encuesta enviados: no se repiten para ninguno de los turnos de la visita. */
async function markAppointmentsSent(type: CampaignType, context: string | null | undefined) {
  const ids = appointmentIdsIn(context);
  if (!ids.length) return;
  if (type === "recordatorio") await sql`update appointments set reminder_sent_at = now() where id = any(${ids}::uuid[])`;
  if (type === "encuesta") await sql`update appointments set survey_sent_at = now() where id = any(${ids}::uuid[])`;
}

/** Suma meses a una fecha AAAA-MM-DD (el 31 pasa al último día del mes si hace falta). */
export function addMonthsKey(key: string, months: number): string {
  const [y, m, d] = key.split("-").map(Number);
  const total = y * 12 + (m - 1) + months;
  const year = Math.floor(total / 12);
  const month = (total % 12) + 1;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(Math.min(d, last)).padStart(2, "0")}`;
}

/** Meses completos entre dos fechas AAAA-MM-DD. */
export function monthsBetween(from: string, to: string): number {
  const [fy, fm, fd] = from.split("-").map(Number);
  const [ty, tm, td] = to.split("-").map(Number);
  return (ty - fy) * 12 + (tm - fm) - (td < fd ? 1 : 0);
}

/** "Control de ortodoncia" → "control de ortodoncia", sin tocar siglas ("PAP anual"). */
function lowerFirst(text: string): string {
  return /^[A-ZÁÉÍÓÚÑ][a-záéíóúñ]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text;
}

/** Lo que comparten todas las audiencias de una clínica en un momento dado. */
type Scope = {
  today: string;
  future: Set<string>;
  recent: Set<string>;
  /** Para el desglose de la audiencia: también cuenta a quienes pidieron la baja (después se restan). */
  includeOptedOut?: boolean;
};

async function audienceScope(clinic: Clinic): Promise<Scope> {
  const days = clinic.contact_cooldown_days ?? 30;
  const [future, recent] = await Promise.all([
    sql<Array<{ patient_id: string }>>`
      select distinct patient_id from appointments
      where clinic_id = ${clinic.id} and status in ('confirmado', 'pendiente') and starts_at >= now()`,
    days > 0
      ? sql<Array<{ patient_id: string }>>`
          select distinct r.patient_id from campaign_recipients r join campaigns c on c.id = r.campaign_id
          where c.clinic_id = ${clinic.id} and c.type = any(${[...ACTIVATION_TYPES]}::text[])
            and r.sent_at >= now() - make_interval(days => ${days})`
      : Promise.resolve([]),
  ]);
  return {
    today: localDateKey(new Date(), clinic.timezone),
    future: new Set(future.map((r) => r.patient_id)),
    recent: new Set(recent.map((r) => r.patient_id)),
  };
}

/** Audiencia propia: pacientes que cumplen las reglas que armó el equipo (Nueva audiencia). */
async function customAudience(
  clinic: Clinic,
  rules: AudienceRules,
  ctx: { today: string; includeOptedOut: boolean; available: (patientId: string) => boolean },
): Promise<AudienceMember[]> {
  const tz = clinic.timezone;
  const today = ctx.today;
  const conditions = [sql`p.clinic_id = ${clinic.id}`, ctx.includeOptedOut ? sql`true` : sql`not p.contact_opt_out`];
  if (rules.monthsSince) conditions.push(sql`l.last_day is not null and l.last_day <= (${today}::date - make_interval(months => ${rules.monthsSince}))::date`);
  const byProfessional = rules.professionalId
    ? sql`(h.professional_id = ${rules.professionalId} or (h.professional_name is not null and h.professional_name ilike (select '%' || pr.full_name || '%' from professionals pr where pr.id = ${rules.professionalId})))`
    : sql`true`;
  if (rules.appointmentTypeId || rules.professionalId) {
    conditions.push(sql`exists (select 1 from history h where h.patient_id = p.id
      and ${rules.appointmentTypeId ? sql`h.appointment_type_id = ${rules.appointmentTypeId}` : sql`true`} and ${byProfessional})`);
  }
  if (rules.coverage) conditions.push(sql`p.coverage ilike ${rules.coverage}`);
  if (rules.ageMin !== null) conditions.push(sql`p.birth_date <= (${today}::date - make_interval(years => ${rules.ageMin}))::date`);
  if (rules.ageMax !== null) conditions.push(sql`p.birth_date > (${today}::date - make_interval(years => ${rules.ageMax + 1}))::date`);
  if (rules.birthdayThisMonth) conditions.push(sql`extract(month from p.birth_date) = extract(month from ${today}::date)`);
  if (rules.noShow) {
    conditions.push(sql`exists (select 1 from appointments a where a.patient_id = p.id and a.status = 'ausente' and a.starts_at >= ${today}::date - interval '12 months')`);
  }
  if (rules.controlIndicated) {
    conditions.push(sql`p.next_control_at <= ${today}::date
      and not exists (select 1 from appointments a where a.patient_id = p.id and a.status = 'atendido' and (a.starts_at at time zone ${tz})::date >= p.next_control_at - 30)
      and not exists (select 1 from patient_visits v where v.patient_id = p.id and v.visited_at >= p.next_control_at - 30)`);
  }
  const where = conditions.reduce((acc, c) => sql`${acc} and ${c}`);
  const rows = await sql<Array<{ id: string; full_name: string | null; phone: string | null; last_day: string | null; type_name: string | null; price: string | null }>>`
    with history as (
      select a.patient_id, (a.starts_at at time zone ${tz})::date as day, a.appointment_type_id, a.professional_id, null::text as professional_name
      from appointments a where a.clinic_id = ${clinic.id} and a.status = 'atendido'
      union all
      select v.patient_id, v.visited_at, v.appointment_type_id, null::uuid, v.professional
      from patient_visits v where v.clinic_id = ${clinic.id}
    ),
    last as (select patient_id, max(day) as last_day from history group by patient_id)
    select p.id, p.full_name, p.phone, l.last_day::text as last_day, t.name as type_name, t.price
    from patients p
    left join last l on l.patient_id = p.id
    left join appointment_types t on t.id = ${rules.appointmentTypeId}::uuid
    where ${where}
    order by l.last_day desc nulls last, p.created_at, p.id
    limit 5000`;
  const sentence = describeRules(rules, { type: rows[0]?.type_name });
  return rows
    .filter((r) => ctx.available(r.id))
    .map((r) => ({
      patient_id: r.id,
      phone: r.phone,
      name: r.full_name,
      reachable: isWhatsAppId(r.phone),
      detail: r.type_name ? lowerFirst(r.type_name) : clinic.name,
      context: `Campaña de audiencia propia (${sentence})${r.last_day ? ` Su última visita fue hace ${monthsBetween(r.last_day, today)} meses.` : ""} Preguntá cómo está y ofrecé un turno.`,
      value: price(r.price),
      appointment_type_id: rules.appointmentTypeId,
    }));
}

export async function computeAudience(clinic: Clinic, type: CampaignType, scope?: Scope, rules?: AudienceRules | null): Promise<AudienceMember[]> {
  const { today, future, recent, includeOptedOut = false } = scope ?? (await audienceScope(clinic));
  const optedOutOk = includeOptedOut ? sql`true` : sql`false`;
  const tz = clinic.timezone;
  const now = Date.now();
  const member = (m: Omit<AudienceMember, "reachable">): AudienceMember => ({ ...m, reachable: isWhatsAppId(m.phone) });
  // A quien ya tiene turno o recibió hace poco otra campaña para volver no se le escribe de nuevo.
  const available = (patientId: string) => !future.has(patientId) && !(ACTIVATION_TYPES.includes(type) && recent.has(patientId));

  if (type === "recordatorio") {
    const from = new Date(now + 12 * 3600_000);
    const to = new Date(now + 36 * 3600_000);
    const rows = await sql<Array<VisitRow & { appointment_type_id: string; price: string | null }>>`
      select a.id, a.starts_at, a.ends_at, a.professional_id, a.appointment_type_id, pr.full_name as professional, coalesce(a.title, t.name) as type_name, t.price,
             json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) as patient
      from appointments a
      join patients p on p.id = a.patient_id
      join professionals pr on pr.id = a.professional_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.status in ('confirmado', 'pendiente') and a.reminder_sent_at is null
        and not (a.status = 'pendiente' and (a.smile_deferred or a.smile_sync is not distinct from 'revisar'))
        and a.starts_at >= ${from} and a.starts_at <= ${to}
      order by a.starts_at`;
    // Dos prácticas seguidas en la misma visita (control y limpieza): un solo recordatorio.
    return groupVisits(rows).map(([r, ...rest]) => {
      const when = humanSlot(new Date(r.starts_at), tz);
      const visit = [r, ...rest];
      const ids = visit.map((v) => `turno_id=${v.id}`).join(", ");
      return member({
        patient_id: r.patient.id,
        phone: r.patient.phone,
        name: r.patient.full_name,
        detail: `${when} con ${r.professional}`,
        context: rest.length
          ? `Recordatorio de la visita del ${when} con ${r.professional}: ${visit.map((v) => v.type_name).join(" y, a continuación, ")} (${ids}). Pedile que confirme si viene: si dice que sí, usá confirmar_turno con cada turno_id; si no puede, ofrecé reprogramar o cancelar.`
          : `Recordatorio del turno de ${r.type_name} el ${when} con ${r.professional} (${ids}). Pedile que confirme si viene: si dice que sí, usá confirmar_turno; si no puede, ofrecé reprogramar o cancelar.`,
        value: sumPrices(visit.map((v) => price(v.price))),
        appointment_type_id: r.appointment_type_id,
      });
    });
  }

  if (type === "recall") {
    // Último turno atendido (o visita importada) de cada paciente y prestación con control periódico.
    const [byType, indicated] = await Promise.all([
      sql<Array<{ patient_id: string; appointment_type_id: string; last_day: string; type_name: string; recall_months: number; price: string | null; full_name: string | null; phone: string | null }>>`
        with history as (
          select a.patient_id, a.appointment_type_id, (a.starts_at at time zone ${tz})::date as day
          from appointments a where a.clinic_id = ${clinic.id} and a.status = 'atendido'
          union all
          select v.patient_id, v.appointment_type_id, v.visited_at
          from patient_visits v where v.clinic_id = ${clinic.id} and v.appointment_type_id is not null
        )
        select distinct on (h.patient_id, h.appointment_type_id)
               h.patient_id, h.appointment_type_id, h.day::text as last_day, t.name as type_name, t.recall_months, t.price, p.full_name, p.phone
        from history h
        join patients p on p.id = h.patient_id
        join appointment_types t on t.id = h.appointment_type_id
        where (${optedOutOk} or not p.contact_opt_out) and t.active and t.recall_months is not null
        order by h.patient_id, h.appointment_type_id, h.day desc`,
      // Controles indicados a un paciente puntual: cuentan como hechos si vino desde 30 días antes de la fecha.
      sql<Array<{ id: string; full_name: string | null; phone: string | null; next_control_at: string; next_control_reason: string | null }>>`
        select p.id, p.full_name, p.phone, p.next_control_at::text as next_control_at, p.next_control_reason
        from patients p
        where p.clinic_id = ${clinic.id} and (${optedOutOk} or not p.contact_opt_out) and p.next_control_at <= ${today}::date
          and not exists (
            select 1 from appointments a where a.patient_id = p.id and a.status = 'atendido'
              and (a.starts_at at time zone ${tz})::date >= p.next_control_at - 30)
          and not exists (select 1 from patient_visits v where v.patient_id = p.id and v.visited_at >= p.next_control_at - 30)`,
    ]);
    const due: Array<{ due: string; member: AudienceMember }> = [];
    for (const p of indicated) {
      if (!available(p.id)) continue;
      const reason = p.next_control_reason?.trim() || "control";
      due.push({
        member: member({
          patient_id: p.id,
          phone: p.phone,
          name: p.full_name,
          detail: lowerFirst(reason),
          context: `Campaña de recall: el equipo le indicó «${reason}» para el ${p.next_control_at.split("-").reverse().join("/")} y todavía no vino. Ofrecé turnos para ese control.`,
          value: null,
        }),
        due: p.next_control_at,
      });
    }
    const indicatedIds = new Set(due.map((d) => d.member.patient_id));
    for (const r of byType) {
      if (indicatedIds.has(r.patient_id) || !available(r.patient_id)) continue;
      const dueDay = addMonthsKey(r.last_day, r.recall_months);
      if (dueDay > today) continue;
      due.push({
        member: member({
          patient_id: r.patient_id,
          phone: r.phone,
          name: r.full_name,
          detail: r.type_name.toLowerCase(),
          context: `Campaña de recall: su último turno de "${r.type_name}" (tipo_turno_id=${r.appointment_type_id}) fue hace ${monthsBetween(r.last_day, today)} meses y corresponde hacerlo cada ${r.recall_months}. Ofrecé turnos para ese control.`,
          value: price(r.price),
          appointment_type_id: r.appointment_type_id,
        }),
        due: dueDay,
      });
    }
    // Un mensaje por paciente: primero los que vencieron hace menos (son los que más responden).
    const seen = new Set<string>();
    const members: AudienceMember[] = [];
    for (const { member: m } of due.sort((a, b) => b.due.localeCompare(a.due))) {
      if (seen.has(m.patient_id)) continue;
      seen.add(m.patient_id);
      members.push(m);
    }
    return members;
  }

  if (type === "reactivacion") {
    const rows = await sql<Array<{ patient_id: string; last_day: string; type_name: string | null; price: string | null; full_name: string | null; phone: string | null }>>`
      with history as (
        select a.patient_id, (a.starts_at at time zone ${tz})::date as day, a.appointment_type_id, null::text as service
        from appointments a where a.clinic_id = ${clinic.id} and a.status = 'atendido'
        union all
        select v.patient_id, v.visited_at, v.appointment_type_id, nullif(v.service, '')
        from patient_visits v where v.clinic_id = ${clinic.id}
      )
      select distinct on (h.patient_id) h.patient_id, h.day::text as last_day, coalesce(t.name, h.service) as type_name, t.price, p.full_name, p.phone
      from history h
      join patients p on p.id = h.patient_id
      left join appointment_types t on t.id = h.appointment_type_id
      where (${optedOutOk} or not p.contact_opt_out)
      order by h.patient_id, h.day desc`;
    return rows
      .filter((r) => available(r.patient_id) && monthsBetween(r.last_day, today) >= clinic.reactivation_months)
      .sort((a, b) => b.last_day.localeCompare(a.last_day))
      .map((r) =>
        member({
          patient_id: r.patient_id,
          phone: r.phone,
          name: r.full_name,
          detail: clinic.name,
          context: `Campaña de reactivación: no viene a la clínica hace ${monthsBetween(r.last_day, today)} meses${r.type_name ? ` (último turno: ${r.type_name})` : ""}. Preguntá cómo está y ofrecé un turno.`,
          value: price(r.price),
        }),
      );
  }

  if (type === "no_show") {
    const rows = await sql<Array<{ patient_id: string; appointment_type_id: string; type_name: string; price: string | null; full_name: string | null; phone: string | null }>>`
      select a.patient_id, a.appointment_type_id, coalesce(a.title, t.name) as type_name, t.price, p.full_name, p.phone
      from appointments a
      join patients p on p.id = a.patient_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.status = 'ausente' and a.starts_at >= ${new Date(now - 30 * 86400_000)}
        and (${optedOutOk} or not p.contact_opt_out)
      order by a.starts_at desc`;
    const seen = new Set<string>();
    const members: AudienceMember[] = [];
    for (const r of rows) {
      if (seen.has(r.patient_id) || !available(r.patient_id)) continue;
      seen.add(r.patient_id);
      members.push(
        member({
          patient_id: r.patient_id,
          phone: r.phone,
          name: r.full_name,
          detail: r.type_name.toLowerCase(),
          context: `Recupero de ausente: faltó a su turno de "${r.type_name}" (tipo_turno_id=${r.appointment_type_id}). Sin retar, ofrecé reprogramarlo.`,
          value: price(r.price),
          appointment_type_id: r.appointment_type_id,
        }),
      );
    }
    return members;
  }

  if (type === "audiencia") {
    if (!rules) return [];
    return customAudience(clinic, rules, { today, includeOptedOut, available });
  }

  if (type === "encuesta") {
    const rows = await sql<Array<{ id: string; patient: PatientRow; professional: string; type_name: string }>>`
      select a.id, pr.full_name as professional, coalesce(a.title, t.name) as type_name,
             json_build_object('id', p.id, 'full_name', p.full_name, 'phone', p.phone) as patient
      from appointments a
      join patients p on p.id = a.patient_id
      join professionals pr on pr.id = a.professional_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id} and a.status = 'atendido' and a.survey_sent_at is null and (${optedOutOk} or not p.contact_opt_out)
        and a.starts_at >= ${new Date(now - 48 * 3600_000)} and a.starts_at <= ${new Date(now)}
      order by a.starts_at`;
    // Una sola encuesta por paciente, aunque haya tenido dos turnos (por ejemplo, control y limpieza
    // seguidos): el contexto nombra todos para que ninguno la vuelva a pedir.
    const byPatient = new Map<string, Array<(typeof rows)[number]>>();
    for (const r of rows) byPatient.set(r.patient.id, [...(byPatient.get(r.patient.id) ?? []), r]);
    return [...byPatient.values()].map(([r, ...rest]) =>
      member({
        patient_id: r.patient.id,
        phone: r.patient.phone,
        name: r.patient.full_name,
        detail: `tu ${r.type_name.toLowerCase()} con ${r.professional}`,
        context: `Encuesta post-consulta: se atendió de "${r.type_name}" con ${r.professional} (${[r, ...rest].map((v) => `turno_id=${v.id}`).join(", ")}). Preguntá del 0 al 10 qué tan probable es que recomiende la clínica y si quiere contar algo más.`,
        value: null,
      }),
    );
  }

  if (type === "lista_espera") {
    const rows = await sql<
      Array<{ patient_id: string; appointment_type_id: string | null; appointment_id: string | null; preferences: string | null; type_name: string | null; price: string | null; full_name: string | null; phone: string | null }>
    >`
      select distinct on (w.patient_id) w.patient_id, w.appointment_type_id, w.appointment_id, w.preferences, t.name as type_name, t.price, p.full_name, p.phone
      from waitlist w
      join patients p on p.id = w.patient_id
      left join appointment_types t on t.id = w.appointment_type_id
      left join appointments a on a.id = w.appointment_id and a.clinic_id = w.clinic_id and a.patient_id = w.patient_id
      where w.clinic_id = ${clinic.id} and w.status = 'activa'
        and (w.appointment_id is null or (a.status = 'confirmado' and a.starts_at > now()))
      order by w.patient_id, w.created_at`;
    return rows.map((r) =>
      member({
        patient_id: r.patient_id,
        phone: r.phone,
        name: r.full_name,
        detail: r.type_name?.toLowerCase() ?? "tu turno",
        context: r.appointment_id
          ? `Está en lista de espera para adelantar su turno existente (turno_id=${r.appointment_id}). Preferencias: ${r.preferences ?? "sin datos"}. Consultá disponibilidad con ese turno_id y gestioná con reprogramar_turno si confirma. No reserves otro turno ni canceles el original para simular el cambio.`
          : `Está en lista de espera para "${r.type_name ?? "un turno"}" (tipo_turno_id=${r.appointment_type_id}). Preferencias: ${r.preferences ?? "sin datos"}. Consultá disponibilidad y ofrecé lo más cercano.`,
        value: price(r.price),
        appointment_type_id: r.appointment_type_id,
      }),
    );
  }

  // Un aviso por celular: una familia con un mismo número lo recibe una vez (a nombre del mayor).
  const rows = await sql<PatientRow[]>`
    select * from (
      select distinct on (phone) id, full_name, phone, created_at from patients
      where clinic_id = ${clinic.id} and (${optedOutOk} or not contact_opt_out) and phone is not null
      order by phone, birth_date nulls last, created_at, id
    ) p order by created_at, id`;
  return rows.map((r) => member({ patient_id: r.id, phone: r.phone, name: r.full_name, detail: clinic.name, context: "Aviso general de la clínica.", value: null }));
}

// ---------------------------------------------------------------------------
// Oportunidades: cuánto hay para recuperar en la base, antes de crear nada.
// ---------------------------------------------------------------------------
export const OPPORTUNITY_TYPES: readonly CampaignType[] = ["recall", "reactivacion", "no_show", "lista_espera", "recordatorio", "encuesta"];

export type Opportunity = {
  type: CampaignType;
  /** A quienes se les puede escribir por WhatsApp. */
  members: AudienceMember[];
  /** Están en la audiencia pero sin un celular válido. */
  unreachable: number;
  /** Suma de los precios de referencia y cuántos de los pacientes tienen uno. */
  value: number;
  priced: number;
  /** Campaña en borrador o en curso de este tipo, para seguirla en lugar de crear otra. */
  open: { id: string; status: Campaign["status"] } | null;
};

export async function opportunities(clinic: Clinic): Promise<{ list: Opportunity[]; patients: number; value: number }> {
  const scope = await audienceScope(clinic);
  const [audiences, open] = await Promise.all([
    Promise.all(OPPORTUNITY_TYPES.map((type) => computeAudience(clinic, type, scope))),
    sql<Array<{ id: string; type: CampaignType; status: Campaign["status"] }>>`
      select distinct on (type) id, type, status from campaigns
      where clinic_id = ${clinic.id} and status in ('borrador', 'enviando')
      order by type, created_at desc`,
  ]);
  const list = OPPORTUNITY_TYPES.map((type, i): Opportunity => {
    const members = audiences[i].filter((m) => m.reachable);
    const priced = members.filter((m) => m.value !== null);
    const campaign = open.find((c) => c.type === type);
    return {
      type,
      members,
      unreachable: audiences[i].length - members.length,
      value: priced.reduce((sum, m) => sum + (m.value ?? 0), 0),
      priced: priced.length,
      open: campaign ? { id: campaign.id, status: campaign.status } : null,
    };
  });
  // Total de la base para volver a agendar: cada paciente una vez, con el turno de mayor valor.
  const best = new Map<string, number>();
  for (const o of list) {
    if (o.type === "recordatorio" || o.type === "encuesta") continue;
    for (const m of o.members) best.set(m.patient_id, Math.max(best.get(m.patient_id) ?? 0, m.value ?? 0));
  }
  return { list, patients: best.size, value: [...best.values()].reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------------------
// Mensaje: el sugerido para el tipo de campaña o uno propio con {nombre} y {detalle}.
// ---------------------------------------------------------------------------
export type AudienceBreakdown = {
  /** Cumplen la regla de la audiencia (antes de sacar a nadie). */
  matching: number;
  optedOut: number;
  hasAppointment: number;
  recentCampaign: number;
  noPhone: number;
  /** Se les puede escribir. */
  reachable: number;
  value: number;
};

/** Quiénes cumplen la regla y por qué quedan afuera los que no reciben el mensaje. */
export async function audienceBreakdown(clinic: Clinic, type: CampaignType, rules?: AudienceRules | null): Promise<AudienceBreakdown> {
  const scope = await audienceScope(clinic);
  const [all, optedOutRows] = await Promise.all([
    computeAudience(clinic, type, { today: scope.today, future: new Set(), recent: new Set(), includeOptedOut: true }, rules),
    sql<Array<{ id: string }>>`select id from patients where clinic_id = ${clinic.id} and contact_opt_out`,
  ]);
  const optedOut = new Set(optedOutRows.map((r) => r.id));
  // Recordatorios, encuesta y lista de espera no miran el tope entre campañas; la baja sí vale para todas.
  // Solo las de volver a sacar turno sacan a quien ya tiene turno o recibió otra campaña hace poco.
  const checksRecent = ACTIVATION_TYPES.includes(type);
  const checksFuture = checksRecent;
  const out: AudienceBreakdown = { matching: all.length, optedOut: 0, hasAppointment: 0, recentCampaign: 0, noPhone: 0, reachable: 0, value: 0 };
  for (const m of all) {
    if (optedOut.has(m.patient_id) && type !== "recordatorio" && type !== "lista_espera") out.optedOut++;
    else if (checksFuture && scope.future.has(m.patient_id)) out.hasAppointment++;
    else if (checksRecent && scope.recent.has(m.patient_id)) out.recentCampaign++;
    else if (!m.reachable) out.noPhone++;
    else {
      out.reachable++;
      out.value += m.value ?? 0;
    }
  }
  return out;
}

export const firstName = (name: string | null | undefined) => name?.trim().split(/\s+/)[0] || "hola";

/** El texto que recibe el paciente (sin el pie de baja: lo suma cada canal). */
export function campaignMessage(campaign: Pick<Campaign, "type" | "message">, name: string | null | undefined, detail: string): string {
  if (!campaign.message?.trim()) return renderTemplate(templateKeyFor(campaign.type), [firstName(name), detail]);
  return campaign.message.trim().replace(/\{\s*(nombre|detalle)\s*\}/gi, (_, key: string) => (key.toLowerCase() === "nombre" ? firstName(name) : detail));
}

/**
 * Enlace que abre el chat con el mensaje escrito, desde el WhatsApp de la clínica: en la compu
 * va directo a WhatsApp Web; en el celular, wa.me abre la app.
 */
export function whatsappLinks(phone: string, text: string): { web: string; app: string } {
  const encoded = encodeURIComponent(text);
  return { web: `https://web.whatsapp.com/send?phone=${phone}&text=${encoded}`, app: `https://wa.me/${phone}?text=${encoded}` };
}

/** Mensaje completo para mandar a mano, con el pie de baja en los que el paciente no pidió. */
export function manualMessage(campaign: Pick<Campaign, "type" | "message">, name: string | null | undefined, detail: string): string {
  return withOptOutFooter(templateKeyFor(campaign.type), campaignMessage(campaign, name, detail));
}

// ---------------------------------------------------------------------------
// Campañas: se crean con su audiencia guardada, se revisan y se envían.
// ---------------------------------------------------------------------------
export async function createCampaign(input: {
  clinicId: string;
  name: string;
  type: CampaignType;
  templateName: string;
  templateLanguage?: string;
  goal?: string;
  automatic?: boolean;
  audience?: { id: string | null; rules: AudienceRules };
  message?: string | null;
}): Promise<Campaign> {
  const [campaign] = await sql<Campaign[]>`
    insert into campaigns ${sql({
      clinic_id: input.clinicId,
      name: input.name,
      type: input.type,
      template_name: input.templateName,
      template_language: input.templateLanguage || "es_AR",
      goal: input.goal || CAMPAIGN_LABELS[input.type].goal,
      automatic: input.automatic ?? false,
      audience_id: input.audience?.id ?? null,
      audience_rules: input.audience ? sql.json(input.audience.rules) : null,
      message: input.message ?? null,
    })}
    returning *`;
  // Las de volver a sacar turno traen el seguimiento sugerido (a los 5 días sin respuesta). Solo sale
  // si la clínica tiene las secuencias prendidas.
  if (ACTIVATION_TYPES.includes(input.type)) {
    await sql`insert into campaign_steps (campaign_id, position, delay_days) values (${campaign.id}, 2, ${DEFAULT_FOLLOWUP_DAYS})`;
  }
  return campaign;
}

/**
 * Guarda la audiencia actual en la campaña: suma a quienes ahora cumplen, actualiza el detalle de los
 * pendientes y saca a los pendientes que ya no corresponden. Quien quitó el equipo sigue afuera y
 * quien ya recibió el mensaje no se toca.
 */
export async function syncAudience(campaignId: string): Promise<{ added: number; removed: number; pending: number }> {
  const [campaign] = await sql<Campaign[]>`select * from campaigns where id = ${campaignId}`;
  if (!campaign) throw new Error("No encontré la campaña.");
  const clinic = await getClinic(campaign.clinic_id);
  const audience = await computeAudience(clinic, campaign.type, undefined, parseRules(campaign.audience_rules));
  let added = 0;
  for (let i = 0; i < audience.length; i += 500) {
    const rows = audience.slice(i, i + 500).map((m) => ({
      campaign_id: campaign.id,
      patient_id: m.patient_id,
      status: m.reachable ? "pendiente" : "excluido",
      error: m.reachable ? null : NOT_REACHABLE,
      detail: m.detail,
      context: m.context,
      value: m.value,
    }));
    const inserted = await sql<Array<{ inserted: boolean }>>`
      insert into campaign_recipients ${sql(rows)}
      on conflict (campaign_id, patient_id) do update set
        detail = excluded.detail, context = excluded.context, value = excluded.value,
        status = case when campaign_recipients.status = 'pendiente' then campaign_recipients.status else excluded.status end,
        error = case when campaign_recipients.status = 'pendiente' then null else excluded.error end
      where campaign_recipients.status = 'pendiente' or (campaign_recipients.status = 'excluido' and campaign_recipients.error is not null)
      returning (xmax = 0) as inserted`;
    added += inserted.filter((r) => r.inserted).length;
  }
  const ids = audience.map((m) => m.patient_id);
  const removed = await sql`
    delete from campaign_recipients
    where campaign_id = ${campaign.id} and status = 'pendiente' and not (patient_id = any(${ids}::uuid[]))
    returning id`;
  const [{ pending }] = await sql<Array<{ pending: number }>>`
    select count(*)::int as pending from campaign_recipients where campaign_id = ${campaign.id} and status in ('pendiente', 'error')`;
  if (campaign.status === "finalizada" && pending > 0) await sql`update campaigns set status = 'enviando' where id = ${campaign.id}`;
  return { added, removed: removed.length, pending };
}

/** Borrador listo para revisar: si ya hay uno de ese tipo sin terminar, se actualiza ese. */
export async function prepareCampaign(
  clinic: Clinic,
  input: { type: CampaignType; name?: string | null; goal?: string | null; templateName?: string | null; audience?: { id: string | null; rules: AudienceRules } },
): Promise<Campaign> {
  if (input.type !== "personalizada" && input.type !== "audiencia") {
    const [open] = await sql<Campaign[]>`
      select * from campaigns where clinic_id = ${clinic.id} and type = ${input.type} and status in ('borrador', 'enviando') and not automatic
      order by created_at desc limit 1`;
    if (open) {
      await syncAudience(open.id);
      return open;
    }
  }
  const month = new Intl.DateTimeFormat("es-AR", { timeZone: clinic.timezone, month: "long", year: "numeric" }).format(new Date());
  const campaign = await createCampaign({
    clinicId: clinic.id,
    name: input.name || `${CAMPAIGN_LABELS[input.type].title} · ${month}`,
    type: input.type,
    // Por WAHA no hay templates de Meta: se manda el texto sugerido para ese tipo.
    templateName: input.templateName || clinic.templates?.[input.type] || input.type,
    templateLanguage: clinic.templates?.idioma || "es_AR",
    goal: input.goal ?? undefined,
    audience: input.audience,
    // Audiencia propia: el mensaje sugerido nombra la prestación si la regla la tiene.
    message:
      input.type === "audiencia"
        ? input.audience?.rules.appointmentTypeId
          ? "¡Hola {nombre}! Ya es momento de volver por tu {detalle}. ¿Querés que te busquemos un turno?"
          : "¡Hola {nombre}! Hace un tiempo que no te vemos por {detalle}. ¿Querés que te busquemos un turno?"
        : null,
  });
  await syncAudience(campaign.id);
  return campaign;
}

/**
 * Quita a un destinatario pendiente de la campaña o lo vuelve a sumar. Volver a sumar también
 * deshace un «Abrir chat» que al final no se mandó.
 */
export async function setRecipientIncluded(clinicId: string, recipientId: string, included: boolean): Promise<boolean> {
  const rows = await sql`
    update campaign_recipients r set status = ${included ? "pendiente" : "excluido"}, error = null,
      sent_at = case when r.manual then null else r.sent_at end,
      messages_sent = case when r.manual then 0 else r.messages_sent end,
      last_message_at = case when r.manual then null else r.last_message_at end, manual = false
    from campaigns c
    where r.id = ${recipientId} and c.id = r.campaign_id and c.clinic_id = ${clinicId}
      and ${included ? sql`(r.status = 'excluido' or (r.status = 'enviado' and r.manual))` : sql`r.status in ('pendiente', 'error')`}
    returning r.id, r.campaign_id`;
  // Un «Abrir chat» que no se mandó tampoco cuenta para el tope del día.
  if (rows.length && included) await sql`delete from campaign_messages where recipient_id = ${rows[0].id} and manual and step = 1`;
  if (rows.length && included) await sql`update campaigns set status = 'enviando' where id = ${rows[0].campaign_id} and status = 'finalizada'`;
  return rows.length > 0;
}

/**
 * El equipo abrió el chat desde el panel para mandarlo desde su WhatsApp: queda como enviado.
 * Si después saca turno (con Sofi, en el panel o por teléfono), cuenta en los resultados.
 */
export async function markManualSent(clinicId: string, recipientId: string): Promise<string | null> {
  const [row] = await sql<Array<{ campaign_id: string; type: CampaignType; context: string | null }>>`
    update campaign_recipients r set status = 'enviado', manual = true, sent_at = now(), error = null,
      messages_sent = 1, last_message_at = now(), next_step_at = null
    from campaigns c
    where r.id = ${recipientId} and c.id = r.campaign_id and c.clinic_id = ${clinicId} and r.status in ('pendiente', 'error')
    returning r.campaign_id, c.type, r.context`;
  if (!row) return null;
  await recordCampaignMessage(await getClinic(clinicId), { campaignId: row.campaign_id, recipientId, step: 1, manual: true });
  await markAppointmentsSent(row.type, row.context);
  await sql`
    update campaigns c set sent_at = now(), status = case
      when exists (select 1 from campaign_recipients r where r.campaign_id = c.id and r.status in ('pendiente', 'error')) then 'enviando' else 'finalizada' end
    where c.id = ${row.campaign_id}`;
  return row.campaign_id;
}

export type SendResult = {
  audience: number;
  sent: number;
  failed: number;
  skipped: number;
  remaining: number;
  errors: string[];
  /** Se frenó porque la línea llegó al tope del día (los que quedan salen mañana). */
  capped?: boolean;
};

export async function sendCampaign(campaignId: string): Promise<SendResult> {
  const [campaign] = await sql<Campaign[]>`select * from campaigns where id = ${campaignId}`;
  if (!campaign) throw new Error("No encontré la campaña.");
  const clinic = await getClinic(campaign.clinic_id);
  const problem = whatsappReadiness(clinic);
  if (problem) throw new Error(problem);

  // Las automáticas (y las campañas de antes de revisar la lista) se envían sin pasar por la revisión.
  const [{ saved }] = await sql<Array<{ saved: number }>>`select count(*)::int as saved from campaign_recipients where campaign_id = ${campaign.id}`;
  if (!saved) await syncAudience(campaign.id);

  // Antes de escribirle, se confirma que cada uno sigue cumpliendo (pudo sacar turno o pedir la baja).
  const current = new Map((await computeAudience(clinic, campaign.type, undefined, parseRules(campaign.audience_rules))).map((m) => [m.patient_id, m]));
  const queue = await sql<Array<{ id: string; patient_id: string }>>`
    select id, patient_id from campaign_recipients
    where campaign_id = ${campaign.id} and status in ('pendiente', 'error')
    order by created_at, id`;

  await sql`update campaigns set status = 'enviando' where id = ${campaign.id}`;
  const result: SendResult = { audience: queue.length, sent: 0, failed: 0, skipped: 0, remaining: 0, errors: [] };
  // Tope por corrida (50) y lo que le queda hoy a la línea de WhatsApp (60 por día en WAHA).
  const usage = await lineUsage(clinic);
  const limit = Math.min(MAX_PER_RUN, usage.left);
  const [followup] = await sql<Array<{ delay_days: number }>>`
    select delay_days from campaign_steps where campaign_id = ${campaign.id} and position = 2 and ${campaign.max_messages ?? 1} >= 2`;

  let attempts = 0;
  for (const row of queue) {
    const member = current.get(row.patient_id);
    if (!member || !member.reachable || !member.phone) {
      await sql`update campaign_recipients set status = 'excluido', error = ${member ? NOT_REACHABLE : NO_LONGER_ELIGIBLE} where id = ${row.id}`;
      result.skipped++;
      continue;
    }
    if (attempts >= limit) {
      result.remaining++;
      if (attempts >= usage.left) result.capped = true;
      continue;
    }
    if (attempts++ > 0) await pauseBetweenSends(clinic);
    const context = `${member.context} Objetivo de la campaña "${campaign.name}": ${campaign.goal}`;
    try {
      const res = await sendPatientMessage(clinic, {
        phone: member.phone,
        templateKey: templateKeyFor(campaign.type),
        templateName: campaign.template_name,
        language: campaign.template_language,
        params: [firstName(member.name), member.detail],
        context,
        campaignId: campaign.id,
        text: campaign.message?.trim() ? campaignMessage(campaign, member.name, member.detail) : undefined,
        patientId: member.patient_id,
      });
      await sql`
        update campaign_recipients set status = 'enviado', elevenlabs_conversation_id = ${res.conversation_id ?? null}, sent_at = now(),
          error = null, detail = ${member.detail}, context = ${member.context}, value = ${member.value},
          messages_sent = 1, last_message_at = now(),
          next_step_at = ${followup ? sql`now() + make_interval(days => ${followup.delay_days})` : null}
        where id = ${row.id}`;
      await recordCampaignMessage(clinic, { campaignId: campaign.id, recipientId: row.id, step: 1 });
      await markAppointmentsSent(campaign.type, member.context);
      result.sent++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      result.failed++;
      result.errors.push(`${member.name ?? member.phone}: ${message.slice(0, 200)}`);
      await sql`update campaign_recipients set status = 'error', error = ${message.slice(0, 500)} where id = ${row.id}`;
    }
  }

  await sql`update campaigns set status = ${result.remaining > 0 ? "enviando" : "finalizada"}, sent_at = now() where id = ${campaign.id}`;
  return result;
}

// ---------------------------------------------------------------------------
// Resultados: de los enviados, cuántos respondieron, sacaron turno y vinieron.
// ---------------------------------------------------------------------------
export type CampaignStats = {
  pending: number;
  excluded: number;
  errors: number;
  sent: number;
  replied: number;
  booked: number;
  attended: number;
  /** Precio de referencia de los turnos que sacaron después del mensaje (con Sofi, en el panel o por teléfono). */
  value: number;
};

export const EMPTY_STATS: CampaignStats = { pending: 0, excluded: 0, errors: 0, sent: 0, replied: 0, booked: 0, attended: 0, value: 0 };

export async function campaignStats(clinicId: string, campaignIds: string[]): Promise<Map<string, CampaignStats>> {
  if (!campaignIds.length) return new Map();
  const rows = await sql<Array<CampaignStats & { campaign_id: string }>>`
    select r.campaign_id,
      count(*) filter (where r.status = 'pendiente')::int as pending,
      count(*) filter (where r.status = 'excluido')::int as excluded,
      count(*) filter (where r.status = 'error')::int as errors,
      count(*) filter (where r.status in ('enviado', 'respondio', 'agendo'))::int as sent,
      count(*) filter (where r.status in ('respondio', 'agendo') or b.status is not null)::int as replied,
      count(*) filter (where r.status = 'agendo' or b.status is not null)::int as booked,
      count(*) filter (where b.status = 'atendido')::int as attended,
      coalesce(sum(t.price), 0)::float8 as value
    from campaign_recipients r
    join campaigns c on c.id = r.campaign_id
    left join lateral (
      select a.status, a.appointment_type_id from appointments a
      where a.patient_id = r.patient_id and r.sent_at is not null and a.status <> 'cancelado'
        and a.created_at >= r.sent_at and a.created_at < r.sent_at + make_interval(days => ${ATTRIBUTION_DAYS})
      order by a.created_at
      limit 1
    ) b on true
    left join appointment_types t on t.id = b.appointment_type_id
    where c.clinic_id = ${clinicId} and r.campaign_id = any(${campaignIds}::uuid[])
    group by r.campaign_id`;
  return new Map(rows.map(({ campaign_id, ...stats }) => [campaign_id, stats]));
}

export type AutomationRun = { clinic_id: string; clinic: string } & (
  | (SendResult & { campaign_id: string; resumed: boolean })
  | { skipped: string }
  | { error: string }
);

/** Por qué una automática no corre en esta clínica (null = corre). */
export function automationBlock(clinic: Pick<Clinic, "is_demo" | "auto_campaigns"> & Partial<Pick<Clinic, "external_reminders">>, type: CampaignType): string | null {
  if (!(AUTO_CAMPAIGN_TYPES as readonly CampaignType[]).includes(type)) {
    return type === "lista_espera" ? "La lista de espera avisa sola cuando se libera un turno." : "Este tipo de campaña no corre solo.";
  }
  if (clinic.is_demo) return "Es un perfil de demo: Sofi no le escribe a nadie.";
  if (type === "recordatorio" && clinic.external_reminders) return `Los recordatorios los manda ${clinic.external_reminders}.`;
  if (!clinic.auto_campaigns?.includes(type as AutoCampaignType)) return "Apagada en esta clínica.";
  return null;
}

/**
 * Corre una campaña automática en una clínica. Si la corrida anterior quedó a mitad (tope de 50 por
 * corrida), sigue esa misma campaña: primero los que quedaron esperando y después los que se sumaron.
 */
async function runClinicAutomation(clinic: Clinic, type: CampaignType): Promise<SendResult & { campaign_id: string; resumed: boolean }> {
  // Por WAHA no hay templates de Meta: se manda el texto de TEMPLATE_TEXTS.
  const templateName = clinic.templates?.[type] ?? (clinic.whatsapp_provider === "waha" ? type : null);
  if (!templateName) throw new Error(`No hay template configurado para "${type}" (Configuración → Templates).`);
  const [open] = await sql<Campaign[]>`
    select * from campaigns where clinic_id = ${clinic.id} and type = ${type} and automatic and status = 'enviando'
    order by created_at limit 1`;
  if (open) {
    await syncAudience(open.id);
    return { ...(await sendCampaign(open.id)), campaign_id: open.id, resumed: true };
  }
  const today = new Intl.DateTimeFormat("es-AR", { timeZone: clinic.timezone, day: "numeric", month: "short" }).format(new Date());
  const campaign = await createCampaign({
    clinicId: clinic.id,
    name: `${CAMPAIGN_LABELS[type].label} · automática ${today}`,
    type,
    templateName,
    templateLanguage: clinic.templates?.idioma || "es_AR",
    automatic: true,
  });
  return { ...(await sendCampaign(campaign.id)), campaign_id: campaign.id, resumed: false };
}

/**
 * Corre una campaña automática (la dispara n8n o un cron). Sin `clinicId`, en cada clínica real que la
 * tenga prendida; con `clinicId`, solo en esa y solo si la tiene prendida. Una clínica que falla no
 * frena a las demás.
 */
export async function runAutomation(type: CampaignType, clinicId?: string, now = new Date()): Promise<AutomationRun[]> {
  const clinics = clinicId
    ? await sql<Clinic[]>`select * from clinics where id = ${clinicId}`
    : await sql<Clinic[]>`select * from clinics where not is_demo and ${type} = any(auto_campaigns) order by created_at`;
  if (clinicId && !clinics.length) throw new Error("No encontré la clínica.");
  const runs: AutomationRun[] = [];
  for (const clinic of clinics) {
    const base = { clinic_id: clinic.id, clinic: clinic.name };
    const blocked =
      automationBlock(clinic, type) ??
      (ACTIVATION_TYPES.includes(type) && !inSendWindow(clinic, now) ? "Fuera del horario de envío (lunes a viernes, de 9 a 20)." : null);
    if (blocked) {
      runs.push({ ...base, skipped: blocked });
      continue;
    }
    try {
      runs.push({ ...base, ...(await runClinicAutomation(clinic, type)) });
    } catch (e) {
      runs.push({ ...base, error: e instanceof Error ? e.message : String(e) });
    }
  }
  return runs;
}
