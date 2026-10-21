import "server-only";
import { sql } from "./db";
import { env } from "./env";
import { formatDateTime } from "./time";
import type { Appointment, AppointmentType, Clinic, Patient, Professional, Schedule } from "./types";

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
  const [first] = await sql<Clinic[]>`select * from clinics order by created_at limit 1`;
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

/** Texto con la información fija de la clínica que el agente usa para responder. */
export function clinicInfoText(clinic: Clinic): string {
  return [
    `Nombre: ${clinic.name}`,
    clinic.address && `Dirección: ${clinic.address}`,
    clinic.phone && `Teléfono: ${clinic.phone}`,
    clinic.hours_text && `Horario de atención: ${clinic.hours_text}`,
    clinic.accepted_coverages.length && `Coberturas aceptadas: ${clinic.accepted_coverages.join(", ")}`,
    clinic.faq && `Preguntas frecuentes:\n${clinic.faq}`,
    clinic.policies && `Políticas:\n${clinic.policies}`,
  ]
    .filter(Boolean)
    .join("\n");
}

/** Catálogo de profesionales y prácticas con sus IDs, para que el agente use las herramientas. */
export function catalogText(catalog: Catalog): string {
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
      `- ${t.name} (${t.specialty}, ${t.duration_min} min) id=${t.id}${t.instructions ? ` | Indicaciones: ${t.instructions}` : ""}`,
  );
  return `PROFESIONALES:\n${proLines.join("\n")}\n\nTIPOS DE TURNO:\n${typeLines.join("\n")}`;
}

export async function patientContextText(clinic: Clinic, patient: Patient | null): Promise<string> {
  if (!patient) return "Paciente nuevo: todavía no tenemos datos. Pedí nombre y apellido, DNI y cobertura antes de reservar.";
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
  const lines = [
    `Nombre: ${patient.full_name ?? "sin dato"}`,
    `DNI: ${patient.dni ?? "sin dato"}`,
    `Cobertura: ${patient.coverage ?? "sin dato"}${patient.coverage_plan ? ` plan ${patient.coverage_plan}` : ""}`,
    patient.preferences && `Preferencias: ${patient.preferences}`,
    patient.memory_summary && `Lo que sabemos de conversaciones anteriores: ${patient.memory_summary}`,
    upcoming.length
      ? `Próximos turnos:\n${upcoming
          .map(
            (a) =>
              `  - ${formatDateTime(a.starts_at, clinic.timezone)} · ${a.type_name} con ${a.professional} (turno_id=${a.id})${a.status === "pendiente" ? " · falta confirmar" : ""}`,
          )
          .join("\n")}`
      : "Próximos turnos: ninguno",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function findPatientByPhone(clinicId: string, phone: string): Promise<Patient | null> {
  if (!phone) return null;
  const [patient] = await sql<Patient[]>`select * from patients where clinic_id = ${clinicId} and phone = ${phone}`;
  return patient ?? null;
}

/** Variables dinámicas que recibe el agente al empezar cada conversación. */
export const INBOUND_CONTEXT = "El paciente inició la conversación.";

export async function buildDynamicVariables(
  clinic: Clinic,
  phone: string,
  opts: { context?: string; campaignId?: string } = {},
): Promise<Record<string, string>> {
  const [catalog, patient] = await Promise.all([getCatalog(clinic.id), findPatientByPhone(clinic.id, phone)]);
  return {
    clinic_id: clinic.id,
    clinic_name: clinic.name,
    agent_name: clinic.agent_name,
    clinic_info: clinicInfoText(clinic),
    clinic_catalog: catalogText(catalog),
    urgency_instructions:
      clinic.urgency_instructions ||
      "Ante cualquier emergencia, indicar que llame al 107 (SAME) o vaya a la guardia más cercana.",
    patient_phone: phone || "desconocido",
    patient_name: patient?.full_name || "desconocido",
    patient_context: await patientContextText(clinic, patient),
    conversation_context: opts.context ?? INBOUND_CONTEXT,
    campaign_id: opts.campaignId ?? "ninguna",
  };
}
