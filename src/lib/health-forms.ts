import "server-only";
import { json, sql } from "./db";
import { formatDate } from "./time";
import {
  addressLine,
  healthFormSheet,
  healthFormTemplate,
  mergeHealthForm,
  missingForCompletion,
  type HealthFormData,
  type HealthFormInput,
  type HealthFormPatient,
} from "./health-form";
import type { AppointmentSource, Patient } from "./types";

// Fichas de salud guardadas: cuándo ofrecerla, guardar lo que responde y leerla para el panel.

export type HealthFormRow = {
  id: string;
  clinic_id: string;
  patient_id: string;
  data: HealthFormData;
  source: string | null;
  conversation_id: string | null;
  invited_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

const DAY_MS = 86400_000;
/** Una ficha completa vale un año: después se ofrece actualizarla. */
export const HEALTH_FORM_VALID_DAYS = 365;
/** Si ya le mandamos la plantilla hace menos que esto, en el próximo turno solo se le recuerda. */
export const HEALTH_FORM_REINVITE_DAYS = 30;

const ageDays = (value: string | null) => (value ? (Date.now() - new Date(value).getTime()) / DAY_MS : Infinity);

export async function latestHealthForm(patientId: string): Promise<HealthFormRow | null> {
  const [row] = await sql<HealthFormRow[]>`
    select * from patient_health_forms where patient_id = ${patientId} order by created_at desc limit 1`;
  return row ?? null;
}

/** ¿Ya se atendió? Turnos atendidos en Turnia o visitas traídas del sistema anterior. */
async function hasVisits(patientId: string): Promise<boolean> {
  const [row] = await sql`
    select 1 from appointments where patient_id = ${patientId} and (status = 'atendido' or (status = 'confirmado' and ends_at < now()))
    union all
    select 1 from patient_visits where patient_id = ${patientId}
    limit 1`;
  return Boolean(row);
}

export type HealthFormOffer = { instrucciones: string; plantilla?: string };

const CHAT_SOURCES: AppointmentSource[] = ["whatsapp", "telegram", "web"];

/**
 * Qué hacer con la ficha de salud después de reservar un turno, o null si no corresponde:
 * - Paciente nuevo (sin visitas) que no la completó: se le manda la plantilla.
 * - Ficha completa hace más de un año: se le ofrece actualizarla.
 * - Pacientes que ya venían antes de Turnia tienen la de papel: no se les ofrece.
 * - Si ya se le mandó hace poco, solo se le recuerda. Por teléfono, solo se le avisa.
 * Al mandar la plantilla queda anotado (invited_at).
 */
export async function healthFormOffer(
  clinicId: string,
  patient: Patient,
  source: AppointmentSource,
  conversationId?: string,
): Promise<HealthFormOffer | null> {
  if (!healthFormSheet(clinicId)) return null;
  if (!CHAT_SOURCES.includes(source) && source !== "telefono") return null;
  const latest = await latestHealthForm(patient.id);
  if (latest?.completed_at && ageDays(latest.completed_at) < HEALTH_FORM_VALID_DAYS) return null;
  const renewal = Boolean(latest?.completed_at);
  const open = latest && !latest.completed_at ? latest : null;
  if (!renewal && !open && (await hasVisits(patient.id))) return null;

  if (source === "telefono") {
    return {
      instrucciones:
        "Por teléfono no se completa la ficha de salud. Después de confirmar el turno, avisale en una frase que antes de que lo atiendan va a tener que completar la ficha de salud en el consultorio.",
    };
  }
  if (open?.invited_at && ageDays(open.invited_at) < HEALTH_FORM_REINVITE_DAYS) {
    return {
      instrucciones: `Ya le mandamos la ficha de salud el ${formatDate(open.invited_at)} y todavía no la completó. Después de confirmar el turno, recordale en una línea que puede completarla por acá o, si no, en el consultorio antes de que lo atiendan. No le mandes la plantilla salvo que la pida: guardar_ficha_salud sin respuestas te la devuelve.`,
    };
  }

  const [row] = open
    ? await sql<HealthFormRow[]>`
        update patient_health_forms set invited_at = now(), conversation_id = coalesce(${conversationId ?? null}, conversation_id), updated_at = now()
        where id = ${open.id} returning *`
    : await sql<HealthFormRow[]>`
        insert into patient_health_forms (clinic_id, patient_id, source, conversation_id, invited_at)
        values (${clinicId}, ${patient.id}, ${source}, ${conversationId ?? null}, now()) returning *`;
  const intro = renewal
    ? "Pasó más de un año desde su última ficha de salud. Después de confirmar el turno, en el mismo mensaje, contale que puede adelantarse actualizando la ficha por acá y que, si no, la va a tener que completar en el consultorio antes de que lo atiendan."
    : "Después de confirmar el turno, en el mismo mensaje, contale que puede adelantarse completando la ficha de salud por acá y que, si no, la va a tener que completar en el consultorio antes de que lo atiendan.";
  return {
    instrucciones: `${intro} Terminá el mensaje con la plantilla tal cual, desde «📋 FICHA DE SALUD» y sin cambiarle nada: le llega en un mensaje aparte para que la copie, la complete y te la mande. Si no quiere, no insistas.`,
    plantilla: healthFormTemplate(row.data, patient),
  };
}

export type SaveHealthFormMeta = { source: string | null; conversationId?: string | null; fechaNacimiento?: string | null; email?: string | null };

/**
 * Suma lo que respondió a su ficha abierta (o a la completa del último año, para corregirla) y,
 * si ya no falta nada, la da por completa. El domicilio, el nacimiento y el mail también van a
 * la ficha del paciente.
 */
export async function saveHealthFormAnswers(
  patient: Patient,
  input: HealthFormInput,
  meta: SaveHealthFormMeta,
): Promise<{ form: HealthFormRow; patient: Patient; missing: string[]; wasComplete: boolean }> {
  return sql.begin(async (tx) => {
    const [latest] = await tx<HealthFormRow[]>`
      select * from patient_health_forms where patient_id = ${patient.id} order by created_at desc limit 1 for update`;
    const editable = latest && (!latest.completed_at || ageDays(latest.completed_at) < HEALTH_FORM_VALID_DAYS) ? latest : null;
    const data = mergeHealthForm(editable?.data ?? {}, input);

    const patch: Partial<Patient> = {};
    const address = addressLine(data);
    if (address && address !== patient.address) patch.address = address;
    if (meta.fechaNacimiento) patch.birth_date = meta.fechaNacimiento;
    if (meta.email) patch.email = meta.email;
    const [updatedPatient] = Object.keys(patch).length
      ? await tx<Patient[]>`update patients set ${tx(patch)} where id = ${patient.id} returning *`
      : [patient];

    const missing = missingForCompletion(data, updatedPatient);
    const complete = missing.length === 0;
    const [form] = editable
      ? await tx<HealthFormRow[]>`
          update patient_health_forms set
            data = ${json(data)},
            conversation_id = coalesce(${meta.conversationId ?? null}, conversation_id),
            completed_at = case when ${complete} then coalesce(completed_at, now()) else completed_at end,
            updated_at = now()
          where id = ${editable.id} returning *`
      : await tx<HealthFormRow[]>`
          insert into patient_health_forms (clinic_id, patient_id, data, source, conversation_id, completed_at)
          values (${patient.clinic_id}, ${patient.id}, ${json(data)}, ${meta.source}, ${meta.conversationId ?? null}, ${complete ? new Date().toISOString() : null})
          returning *`;
    return { form, patient: updatedPatient, missing, wasComplete: Boolean(editable?.completed_at) };
  });
}

/** Marca que se le mandó la plantilla (la pidió por chat). */
export async function markHealthFormInvited(formId: string): Promise<void> {
  await sql`update patient_health_forms set invited_at = now() where id = ${formId}`;
}

/** Datos del paciente que van en la hoja. */
export function sheetPatient(patient: Patient): HealthFormPatient {
  return {
    full_name: patient.full_name,
    dni: patient.dni,
    birth_date: patient.birth_date,
    email: patient.email,
    phone: patient.phone,
    coverage: patient.coverage,
    coverage_plan: patient.coverage_plan,
    member_number: patient.member_number,
    address: patient.address,
    sex: patient.sex,
  };
}
