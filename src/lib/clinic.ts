import "server-only";
import { db, unwrap } from "./supabase";
import { env } from "./env";
import { formatDateTime } from "./time";
import type { Appointment, AppointmentType, Clinic, Patient, Professional, Schedule } from "./types";

const WEEKDAY_NAMES = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

export async function getClinic(id?: string): Promise<Clinic> {
  const clinicId = id || env.defaultClinicId();
  const result = await db().from("clinics").select("*").eq("id", clinicId).maybeSingle();
  if (result.error) throw new Error(`No se pudo leer la clínica: ${result.error.message}`);
  if (result.data) return result.data as Clinic;
  // Si el ID por defecto no existe, usamos la primera clínica cargada.
  const first = unwrap<Clinic[]>(await db().from("clinics").select("*").order("created_at").limit(1), "clínicas");
  if (!first.length) throw new Error("No hay ninguna clínica cargada. Corré supabase/seed.sql o creá una.");
  return first[0];
}

/** Busca la clínica que corresponde a un agente o a un número de WhatsApp (multi-clínica). */
export async function resolveClinic(opts: { agentId?: string | null; whatsappPhoneNumberId?: string | null }): Promise<Clinic> {
  if (opts.whatsappPhoneNumberId) {
    const r = await db().from("clinics").select("*").eq("whatsapp_phone_number_id", opts.whatsappPhoneNumberId).maybeSingle();
    if (r.data) return r.data as Clinic;
  }
  if (opts.agentId) {
    const r = await db().from("clinics").select("*").eq("elevenlabs_agent_id", opts.agentId).maybeSingle();
    if (r.data) return r.data as Clinic;
  }
  return getClinic();
}

export type Catalog = {
  professionals: Professional[];
  appointmentTypes: AppointmentType[];
  schedules: Schedule[];
};

export async function getCatalog(clinicId: string): Promise<Catalog> {
  const [pros, types] = await Promise.all([
    db().from("professionals").select("*").eq("clinic_id", clinicId).eq("active", true).order("full_name"),
    db().from("appointment_types").select("*").eq("clinic_id", clinicId).eq("active", true).order("specialty"),
  ]);
  const professionals = unwrap(pros, "profesionales") as Professional[];
  const ids = professionals.map((p) => p.id);
  const schedules = ids.length
    ? (unwrap(await db().from("schedules").select("*").in("professional_id", ids), "horarios") as Schedule[])
    : [];
  return { professionals, appointmentTypes: unwrap(types, "tipos de turno") as AppointmentType[], schedules };
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
  const upcoming = unwrap(
    await db()
      .from("appointments")
      .select("id, starts_at, status, professionals(full_name), appointment_types(name)")
      .eq("patient_id", patient.id)
      .in("status", ["confirmado", "pendiente"])
      .gte("starts_at", new Date().toISOString())
      .order("starts_at")
      .limit(5),
    "turnos del paciente",
  ) as unknown as Array<
    Pick<Appointment, "id" | "starts_at" | "status"> & {
      professionals: { full_name: string } | null;
      appointment_types: { name: string } | null;
    }
  >;
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
              `  - ${formatDateTime(a.starts_at, clinic.timezone)} · ${a.appointment_types?.name ?? "turno"} con ${a.professionals?.full_name ?? "profesional"} (turno_id=${a.id})`,
          )
          .join("\n")}`
      : "Próximos turnos: ninguno",
  ];
  return lines.filter(Boolean).join("\n");
}

export async function findPatientByPhone(clinicId: string, phone: string): Promise<Patient | null> {
  if (!phone) return null;
  const r = await db().from("patients").select("*").eq("clinic_id", clinicId).eq("phone", phone).maybeSingle();
  if (r.error) throw new Error(`No se pudo buscar el paciente: ${r.error.message}`);
  return (r.data as Patient) ?? null;
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
