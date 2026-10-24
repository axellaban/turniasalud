"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { isUuid } from "@/lib/clinic";
import { disconnect, getConnection, listCalendars } from "@/lib/calendar/google";
import { resyncProfessional, syncCalendarLater, syncPendingCalendar } from "@/lib/calendar/sync";
import { getPanelClinic, logClinicChange } from "@/lib/panel-clinic";

// Configuración → Calendario: elegir el calendario de cada profesional, sincronizar y desconectar.

export type CalendarFormState = { ok?: boolean; message?: string };

export async function saveProfessionalCalendar(_prev: CalendarFormState | undefined, form: FormData): Promise<CalendarFormState> {
  const clinic = await getPanelClinic(form);
  const professionalId = form.get("professional_id");
  const calendarId = String(form.get("calendar_id") ?? "");
  if (!isUuid(professionalId)) return { ok: false, message: "Profesional inválido." };
  const conn = await getConnection(clinic.id);
  if (!conn) return { ok: false, message: "Primero conectá la cuenta de Google." };
  let name: string | null = null;
  if (calendarId) {
    // Solo calendarios de la cuenta conectada en los que Turnia puede escribir.
    const calendars = await listCalendars(conn).catch(() => null);
    if (!calendars) return { ok: false, message: "Google no respondió. Probá de nuevo en un momento." };
    const found = calendars.find((c) => c.id === calendarId);
    if (!found) return { ok: false, message: "Ese calendario ya no está disponible en la cuenta conectada." };
    name = found.name;
  }
  const [row] = await sql`
    update professionals set google_calendar_id = ${calendarId || null}, google_calendar_name = ${name},
      google_busy = null, google_busy_at = null
    where id = ${professionalId} and clinic_id = ${clinic.id} returning id`;
  if (!row) return { ok: false, message: "El profesional ya no existe." };
  await resyncProfessional(professionalId);
  await logClinicChange(clinic.id, "Calendario");
  syncCalendarLater(clinic.id);
  revalidatePath("/panel/configuracion/calendario");
  return { ok: true, message: calendarId ? `Listo: usa «${name}». Sus turnos próximos se pasan a ese calendario.` : "Listo: este profesional ya no se sincroniza." };
}

export async function syncCalendarNow(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  // Los que fallaron vuelven a intentarse desde cero.
  await sql`update appointments set calendar_attempts = 0 where clinic_id = ${clinic.id} and calendar_sync = 'error'`;
  await sql`update professionals set google_busy_at = null where clinic_id = ${clinic.id}`;
  await syncPendingCalendar(clinic.id);
  revalidatePath("/panel/configuracion/calendario");
}

export async function disconnectCalendar(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  await disconnect(clinic.id);
  await logClinicChange(clinic.id, "Calendario");
  revalidatePath("/panel/configuracion/calendario");
}
