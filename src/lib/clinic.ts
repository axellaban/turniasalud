import "server-only";
import { sql } from "./db";
import { env } from "./env";
import { expandBlocks, isOpenAt } from "./slots";
import { formatDate, formatDateTime } from "./time";
import { patientForPhone } from "./patients";
import type { Appointment, AppointmentType, Clinic, Patient, Professional, Schedule, ScheduleBlock, Task } from "./types";

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === "string" && UUID.test(value);

export async function getClinic(id?: string): Promise<Clinic> {
  const clinicId = id || env.defaultClinicId();
  if (isUuid(clinicId)) {
    const [clinic] = await sql<Clinic[]>`select * from clinics where id = ${clinicId}`;
    if (clinic) return clinic;
  }
  // Si el ID por defecto no existe, usamos la primera clínica cargada.
  const [first] = await sql<Clinic[]>`select * from clinics where not is_demo order by created_at limit 1`;
  if (!first) throw new Error("No hay ninguna clínica cargada. Corré supabase/seed.sql o creá una.");
  return first;
}

/** Busca la clínica que corresponde a un agente o a un número de WhatsApp (multi-clínica). */
export async function resolveClinic(opts: { agentId?: string | null; whatsappPhoneNumberId?: string | null }): Promise<Clinic> {
  if (opts.whatsappPhoneNumberId) {
    const [clinic] = await sql<Clinic[]>`select * from clinics where whatsapp_phone_number_id = ${opts.whatsappPhoneNumberId} limit 1`;
    if (clinic) return clinic;
  }
  if (opts.agentId) {
    const [clinic] = await sql<Clinic[]>`select * from clinics where elevenlabs_agent_id = ${opts.agentId} limit 1`;
    if (clinic) return clinic;
  }
  return getClinic();
}

export type Catalog = {
  professionals: Professional[];
  appointmentTypes: AppointmentType[];
  schedules: Schedule[];
};

export async function getCatalog(clinicId: string): Promise<Catalog> {
  const [professionals, appointmentTypes, schedules] = await Promise.all([
    sql<Professional[]>`select * from professionals where clinic_id = ${clinicId} and active order by full_name`,
    sql<AppointmentType[]>`select * from appointment_types where clinic_id = ${clinicId} and active order by specialty, name`,
    sql<Schedule[]>`
      select s.* from schedules s
      join professionals p on p.id = s.professional_id
      where p.clinic_id = ${clinicId} and p.active
      order by s.weekday, s.start_time`,
  ]);
  return { professionals: [...professionals], appointmentTypes: [...appointmentTypes], schedules: [...schedules] };
}

/** Feriados, vacaciones y bloqueos que se superponen con el rango pedido. */
export async function getScheduleBlocks(clinicId: string, from: Date | string, to: Date | string): Promise<ScheduleBlock[]> {
  const rows = await sql<ScheduleBlock[]>`
    select * from schedule_blocks
    where clinic_id = ${clinicId} and starts_at < ${to} and ends_at > ${from}
    order by starts_at`;
  return [...rows];
}

/** Texto con la información fija de la clínica que el agente usa para responder. */
export function clinicInfoText(clinic: Clinic, openNow?: boolean): string {
  return [
    `Nombre: ${clinic.name}`,
    `Especialidad: ${clinic.specialty}`,
    clinic.website && `Web: ${clinic.website}`,
    clinic.handoff_phone && `Teléfono de recepción para derivaciones: ${clinic.handoff_phone}`,
    openNow !== undefined &&
      `Ahora mismo: ${openNow ? "dentro del horario de atención (hay profesionales atendiendo)" : "fuera del horario de atención"}`,
    clinic.address && `Dirección: ${clinic.address}`,
    clinic.phone && `Teléfono: ${clinic.phone}`,
    clinic.hours_text && `Horario de atención: ${clinic.hours_text}`,
    clinic.accepted_coverages.length && `Coberturas aceptadas: ${clinic.accepted_coverages.join(", ")}`,
    clinic.faq && `Preguntas frecuentes:\n${clinic.faq}`,
    clinic.policies && `Políticas:\n${clinic.policies}`,
    clinic.payment_methods && `Formas de pago:\n${clinic.payment_methods}`,
    clinic.agent_context && `Instrucciones de esta clínica:\n${clinic.agent_context}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Catálogo de profesionales y prácticas con sus IDs, para que el agente use las herramientas. */
export function catalogText(catalog: Catalog, blocks: ScheduleBlock[] = [], timeZone?: string): string {
  const proLines = catalog.professionals.map((p) => {
    const days = catalog.schedules
      .filter((s) => s.professional_id === p.id)
      .sort((a, b) => a.weekday - b.weekday)
      .map((s) => `${WEEKDAY_NAMES[s.weekday]} ${s.start_time.slice(0, 5)}-${s.end_time.slice(0, 5)}`)
      .join(", ");
    const coverages = p.accepted_coverages?.length ? ` | Solo atiende: ${p.accepted_coverages.join(", ")}` : "";
    return `- ${p.full_name} (${p.specialty}) id=${p.id} | Atiende: ${days || "sin horarios cargados"}${coverages}${p.bio ? ` | ${p.bio}` : ""}`;
  });
  const typeLines = catalog.appointmentTypes.map(
    (t) =>
      `- ${t.name} (${t.specialty}, ${t.duration_min} min) id=${t.id}${t.price ? ` | Precio de referencia: $${t.price}` : ""}${t.instructions ? ` | Indicaciones: ${t.instructions}` : ""}`,
  );
  const names = new Map(catalog.professionals.map((p) => [p.id, p.full_name]));
  const blockLines = blocks.map((b) => {
    const who = b.professional_id ? (names.get(b.professional_id) ?? "un profesional") : "toda la clínica";
    const from = formatDateTime(b.starts_at, timeZone);
    const to = formatDateTime(b.ends_at, timeZone);
    return `- ${who}: del ${from} al ${to}${b.reason ? ` (${b.reason})` : ""}`;
  });
  const text = `PROFESIONALES:\n${proLines.join("\n")}\n\nTIPOS DE TURNO:\n${typeLines.join("\n")}`;
  return blockLines.length ? `${text}\n\nDÍAS SIN ATENCIÓN (próximos 60 días):\n${blockLines.join("\n")}` : text;
}

/** Sin ficha para este número: puede ser nuevo o un paciente que escribe desde otro lado. */
export const NO_PATIENT_CONTEXT =
  "No hay una ficha para este número. Si dice o da a entender que ya es paciente, usá buscar_paciente con su DNI y su nombre y apellido (pedile solo lo que no te haya dicho) antes de pedir cualquier otro dato. Si es nuevo, pedí nombre y apellido, DNI y cobertura antes de reservar.";

const loaded = (value: unknown, label = "cargado") => (value ? label : "sin dato");

export async function patientContextText(clinic: Clinic, patient: Patient | null): Promise<string> {
  if (!patient) return NO_PATIENT_CONTEXT;
  const upcoming = await sql<
    Array<Pick<Appointment, "id" | "starts_at" | "status"> & { professional: string; type_name: string }>
  >`
    select a.id, a.starts_at, a.status, pr.full_name as professional, t.name as type_name
    from appointments a
    join professionals pr on pr.id = a.professional_id
    join appointment_types t on t.id = a.appointment_type_id
    where a.patient_id = ${patient.id} and a.status in ('confirmado', 'pendiente') and a.starts_at >= now()
    order by a.starts_at
    limit 5`;
  const requests = await sql<Array<Pick<Task, "title" | "status" | "response" | "responded_at" | "created_at">>>`
    select title, status, response, responded_at, created_at from tasks
    where patient_id = ${patient.id} and (status <> 'resuelta' or responded_at > now() - interval '30 days')
    order by created_at desc
    limit 5`;
  // Última vez que vino: turnos atendidos en Turnia o visitas traídas de la importación.
  const [last] = await sql<Array<{ visited_at: string; service: string | null }>>`
    select visited_at, service from (
      select (a.starts_at at time zone ${clinic.timezone})::date::text as visited_at, t.name as service
      from appointments a join appointment_types t on t.id = a.appointment_type_id
      where a.patient_id = ${patient.id} and (a.status = 'atendido' or (a.status = 'confirmado' and a.ends_at < now()))
      union all
      select v.visited_at::text, coalesce(t.name, nullif(v.service, '')) as service
      from patient_visits v left join appointment_types t on t.id = v.appointment_type_id
      where v.patient_id = ${patient.id}
    ) visits
    order by visited_at desc
    limit 1`;
  const particular = /particular/i.test(patient.coverage ?? "");
  const missing = [
    !patient.full_name && "nombre y apellido",
    !patient.dni && "DNI",
    !patient.birth_date && "fecha de nacimiento",
    !patient.email && "mail",
    !patient.coverage && "cobertura",
    patient.coverage && !particular && !patient.member_number && "número de afiliado",
  ].filter(Boolean);
  const yearAgo = new Date(Date.now() - 365 * 86400_000).toISOString().slice(0, 10);
  const lines = [
    patient.dni
      ? "Ya tiene ficha: no le vuelvas a pedir los datos que están cargados."
      : "Hay una ficha incompleta para este número (sin DNI). Si dice que ya es paciente, usá buscar_paciente con su DNI y su nombre y apellido; si no, pedí los datos que faltan.",
    `Nombre: ${patient.full_name ?? "sin dato"}`,
    `DNI: ${patient.dni ?? "sin dato"}`,
    `Fecha de nacimiento: ${loaded(patient.birth_date, "cargada")}`,
    `Mail: ${loaded(patient.email)}`,
    `Cobertura: ${patient.coverage ?? "sin dato"}${patient.coverage_plan ? ` plan ${patient.coverage_plan}` : ""}`,
    patient.coverage && !particular && `Número de afiliado: ${loaded(patient.member_number)}`,
    missing.length ? `Faltan en la ficha (pedilos antes de reservar): ${missing.join(", ")}` : "La ficha está completa.",
    last
      ? `Ya se atendió en el consultorio. Última visita: ${formatDate(`${last.visited_at}T12:00:00Z`, "UTC")}${last.service ? ` (${last.service})` : ""}${last.visited_at < yearAgo ? ", hace más de un año" : ""}. No le preguntes si ya vino antes.`
      : "Todavía no tiene visitas registradas en el consultorio.",
    patient.preferences && `Preferencias: ${patient.preferences}`,
    patient.memory_summary &&
      `Lo que sabemos de conversaciones anteriores (entre corchetes, el día en que lo contó; sin fecha, es una nota vieja): ${patient.memory_summary}`,
    upcoming.length
      ? `Próximos turnos:\n${upcoming
          .map(
            (a) =>
              `  - ${formatDateTime(a.starts_at, clinic.timezone)} · ${a.type_name} con ${a.professional} (turno_id=${a.id})${a.status === "pendiente" ? " · falta confirmar" : ""}`,
          )
          .join("\n")}`
      : "Próximos turnos: ninguno",
    requests.length &&
      `Pedidos al equipo:\n${requests
        .map((t) =>
          t.status === "resuelta"
            ? `  - ${t.title} (pedido el ${formatDate(t.created_at, clinic.timezone)}): resuelto${t.response ? `. Respuesta del equipo: ${t.response}` : ""}`
            : `  - ${t.title} (pedido el ${formatDate(t.created_at, clinic.timezone)}): ${t.status === "en_curso" ? "en curso" : "pendiente"}`,
        )
        .join("\n")}`,
  ];
  return lines.filter(Boolean).join("\n");
}

/** Ficha del paciente que escribe desde este número (o de otro número suyo ya identificado). */
export async function findPatientByPhone(clinicId: string, phone: string): Promise<Patient | null> {
  return patientForPhone(sql, clinicId, phone);
}

/** Variables dinámicas que recibe el agente al empezar cada conversación. */
export const INBOUND_CONTEXT = "El paciente inició la conversación.";

export async function buildDynamicVariables(
  clinic: Clinic,
  phone: string,
  opts: { context?: string; campaignId?: string } = {},
): Promise<Record<string, string>> {
  const now = new Date();
  const [catalog, patient, blocks] = await Promise.all([
    getCatalog(clinic.id),
    findPatientByPhone(clinic.id, phone),
    getScheduleBlocks(clinic.id, now, new Date(now.getTime() + 60 * 86400_000)),
  ]);
  const proIds = catalog.professionals.map((p) => p.id);
  const openNow = isOpenAt(catalog.schedules, expandBlocks(blocks, proIds), now, clinic.timezone);
  const urgency =
    clinic.urgency_instructions || "Ante cualquier emergencia, indicar que llame al 107 (SAME) o vaya a la guardia más cercana.";
  return {
    clinic_id: clinic.id,
    clinic_name: clinic.name,
    agent_name: clinic.agent_name,
    clinic_info: clinicInfoText(clinic, openNow),
    clinic_catalog: catalogText(catalog, blocks, clinic.timezone),
    urgency_instructions: clinic.after_hours_instructions
      ? `${urgency}\nFuera del horario de atención: ${clinic.after_hours_instructions}`
      : urgency,
    patient_phone: phone || "desconocido",
    patient_name: patient?.full_name || "desconocido",
    patient_context: await patientContextText(clinic, patient),
    conversation_context: opts.context ?? INBOUND_CONTEXT,
    campaign_id: opts.campaignId ?? "ninguna",
  };
}
