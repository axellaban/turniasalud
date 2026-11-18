import "server-only";
import { sql, type TransactionSql } from "../db";
import { normalizePhone } from "../phone";

// Gestionar un turno desde otro número: si la clínica lo pide (clinics.verify_appointment_access), Sofi
// verifica la identidad y da un permiso temporal solo para esa charla, sin unir ese celular a la ficha.
// Empezó en Guerra–Mininni; ahora es una opción de cada clínica (Configuración → Turnos y urgencias).

type AccessContext = { clinicId: string; patientPhone: string; conversationId?: string };

/** ¿La clínica usa el permiso temporal para gestionar turnos desde otro número? */
export async function appointmentAccessEnabled(clinicId: string, db: TransactionSql | typeof sql = sql): Promise<boolean> {
  const [row] = await db<{ on: boolean }[]>`select verify_appointment_access as on from clinics where id = ${clinicId}`;
  return Boolean(row?.on);
}

/** La clave del permiso temporal de esta charla, o null si no corresponde. `enabled`: la opción de la clínica. */
export function appointmentAccessKey(ctx: AccessContext, enabled: boolean) {
  const phone = normalizePhone(ctx.patientPhone);
  if (!enabled || !/^\d{10,15}$/.test(phone) || !/^conv_[a-z0-9_-]{1,120}$/i.test(ctx.conversationId ?? "")) return null;
  return { clinic_id: ctx.clinicId, phone, conversation_id: ctx.conversationId! };
}

export async function readAppointmentAccess(ctx: AccessContext) {
  const key = appointmentAccessKey(ctx, await appointmentAccessEnabled(ctx.clinicId));
  if (!key) return null;
  const [access] = await sql<{ patient_id: string; active: boolean }[]>`
    select patient_id, expires_at > now() as active from conversation_appointment_access
    where clinic_id = ${key.clinic_id} and phone = ${key.phone} and conversation_id = ${key.conversation_id}`;
  return access ?? null;
}

/** Una verificación explícita reemplaza cualquier permiso anterior de esa charla. */
export async function expireAppointmentAccess(ctx: AccessContext) {
  const key = appointmentAccessKey(ctx, await appointmentAccessEnabled(ctx.clinicId));
  if (!key) return;
  await sql`update conversation_appointment_access set expires_at = now()
    where clinic_id = ${key.clinic_id} and phone = ${key.phone} and conversation_id = ${key.conversation_id} and expires_at > now()`;
}

export async function grantAppointmentAccess(tx: TransactionSql, key: NonNullable<ReturnType<typeof appointmentAccessKey>>, patientId: string) {
  await tx`delete from conversation_appointment_access where expires_at < now() - interval '7 days'`;
  await tx`
    insert into conversation_appointment_access ${tx({ ...key, patient_id: patientId })}
    on conflict (clinic_id, phone, conversation_id) do update set patient_id = excluded.patient_id, expires_at = excluded.expires_at`;
}
