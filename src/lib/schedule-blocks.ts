import "server-only";
import { sql } from "./db";
import { addDaysKey, parseDateKey, zonedTimeToUtc } from "./time";
import type { Clinic } from "./types";

/**
 * Bloquea la agenda (feriado, vacaciones, un rato sin atender) para toda la clínica o un profesional.
 * Lo usan Configuración → Feriados y bloqueos y, por WhatsApp, el equipo del consultorio con Sofi.
 * Devuelve cuántos turnos ya dados caen en el bloqueo (no se cancelan solos).
 */
export async function createScheduleBlock(
  clinic: Pick<Clinic, "id" | "timezone">,
  input: { professionalId: string | null; from: string | null; to?: string | null; timeFrom?: string | null; timeTo?: string | null; reason?: string | null },
): Promise<{ ok: true; affected: number; startsAt: Date; endsAt: Date } | { ok: false; message: string }> {
  const fromKey = parseDateKey(input.from ?? undefined);
  const toKey = parseDateKey(input.to ?? undefined) ?? fromKey;
  if (!fromKey || !toKey || toKey < fromKey) return { ok: false, message: "Revisá las fechas." };
  const time = (value: string | null | undefined) => /^(\d{2}):(\d{2})$/.exec(value ?? "");
  const startTime = time(input.timeFrom);
  const endTime = time(input.timeTo);
  const [fy, fm, fd] = fromKey.split("-").map(Number);
  const startsAt = zonedTimeToUtc(fy, fm, fd, startTime ? Number(startTime[1]) : 0, startTime ? Number(startTime[2]) : 0, clinic.timezone);
  // Sin hora de fin, el bloqueo dura hasta el final del último día.
  const [ty, tm, td] = (endTime ? toKey : addDaysKey(toKey, 1)).split("-").map(Number);
  const endsAt = zonedTimeToUtc(ty, tm, td, endTime ? Number(endTime[1]) : 0, endTime ? Number(endTime[2]) : 0, clinic.timezone);
  if (endsAt <= startsAt) return { ok: false, message: "La hora de fin tiene que ser posterior a la de inicio." };
  const professionalId = input.professionalId;
  const [block] = await sql<Array<{ id: string }>>`
    insert into schedule_blocks (clinic_id, professional_id, starts_at, ends_at, reason)
    select ${clinic.id}::uuid, ${professionalId}::uuid, ${startsAt}::timestamptz, ${endsAt}::timestamptz, ${input.reason?.trim() || null}::text
    where ${professionalId}::uuid is null
       or exists (select 1 from professionals where id = ${professionalId} and clinic_id = ${clinic.id})
    returning id`;
  if (!block) return { ok: false, message: "No encontré ese profesional." };
  const [{ affected }] = await sql<Array<{ affected: number }>>`
    select count(*)::int as affected from appointments
    where clinic_id = ${clinic.id} and status in ('confirmado', 'pendiente')
      and starts_at < ${endsAt} and ends_at > ${startsAt}
      ${professionalId ? sql`and (professional_id = ${professionalId} or second_professional_id = ${professionalId})` : sql``}`;
  return { ok: true, affected, startsAt, endsAt };
}
