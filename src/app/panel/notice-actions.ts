"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/clinic";
import { NOTICE_KINDS, sendTestNotice, type NoticeKind } from "@/lib/clinic-notices";
import { sql } from "@/lib/db";
import { getPanelClinic, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
import { normalizePhone } from "@/lib/phone";
import type { FormState } from "./actions";

// Panel → Configuración → Avisos al consultorio por WhatsApp. Los carga el propio consultorio:
// a qué celulares les llega el aviso de cada turno que da, mueve o cancela Sofi.

const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};

const isState = (value: { id: string } | FormState): value is FormState => !("id" in value);

async function clinicOf(form: FormData): Promise<{ id: string } | FormState> {
  try {
    return await getPanelClinic(form);
  } catch (error) {
    // Otra pestaña cambió la clínica elegida: se avisa acá, sin perder lo escrito.
    if (error instanceof Error && error.message.includes("clínica seleccionada")) return { ok: false, message: error.message };
    throw error;
  }
}

export async function addNoticePhone(_previous: FormState, form: FormData): Promise<FormState> {
  const clinic = await clinicOf(form);
  if (isState(clinic)) return clinic;
  const name = text(form, "name")?.slice(0, 80);
  const phone = normalizePhone(text(form, "phone"));
  const events = NOTICE_KINDS.filter((k) => form.get(`event_${k}`) === "on");
  if (!name) return { ok: false, message: "Escribí de quién es (por ejemplo, Recepción)." };
  if (!/^\d{10,15}$/.test(phone)) return { ok: false, message: "Revisá el celular: con código de área, por ejemplo 223 555-0100." };
  if (!events.length) return { ok: false, message: "Elegí al menos un aviso: turnos nuevos, movidos o cancelados." };
  const [row] = await sql`
    insert into clinic_notice_phones (clinic_id, phone, name, events) values (${clinic.id}, ${phone}, ${name}, ${events})
    on conflict (clinic_id, phone) do update set name = excluded.name, events = excluded.events
    returning (xmax = 0) as created`;
  revalidatePath("/panel/configuracion", "layout");
  return {
    ok: true,
    message: row.created
      ? `Listo: a ${name} le van a llegar los avisos. Mandale uno de prueba para confirmar que llega.`
      : `Actualizado: ${name} recibe ${events.length === NOTICE_KINDS.length ? "todos los avisos" : "los avisos elegidos"}.`,
  };
}

export async function removeNoticePhone(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  const id = text(form, "id");
  if (isUuid(id)) await sql`delete from clinic_notice_phones where id = ${id} and clinic_id = ${clinic.id}`;
  revalidatePath("/panel/configuracion", "layout");
}

export async function setNoticeEvents(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  const id = text(form, "id");
  const events: NoticeKind[] = NOTICE_KINDS.filter((k) => form.get(`event_${k}`) === "on");
  // Sin ningún aviso elegido, el celular no tiene sentido: se deja como estaba.
  if (isUuid(id) && events.length) {
    await sql`update clinic_notice_phones set events = ${events} where id = ${id} and clinic_id = ${clinic.id}`;
  }
  revalidatePath("/panel/configuracion", "layout");
}

export async function testNoticePhone(_previous: FormState, form: FormData): Promise<FormState> {
  const clinic = await clinicOf(form);
  if (isState(clinic)) return clinic;
  const id = text(form, "id");
  if (!isUuid(id)) return { ok: false, message: "No encontré ese celular." };
  const result = await sendTestNotice(clinic.id, id);
  revalidatePath("/panel/configuracion", "layout");
  return result;
}

// Configuración → Equipo por WhatsApp: una sola lista con lo que recibe cada celular del equipo.
// Por dentro siguen siendo dos tablas (avisos y acceso total), así que el envío de avisos (también
// los de Smile Connect) y el acceso de Sofi no cambian: esto solo las carga juntas.

/** Agregar a alguien del equipo con todo lo que recibe. El acceso total y el resumen los da Turnia. */
export async function addTeamMember(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requirePanelSession();
  const clinic = await clinicOf(form);
  if (isState(clinic)) return clinic;
  const name = text(form, "name")?.slice(0, 80);
  const phone = normalizePhone(text(form, "phone"));
  const events = NOTICE_KINDS.filter((k) => form.get(`event_${k}`) === "on");
  const access = form.get("access") === "on";
  const summary = form.get("summary") === "on";
  if (!name) return { ok: false, message: "Escribí de quién es (por ejemplo, Recepción)." };
  if (!/^\d{10,15}$/.test(phone)) return { ok: false, message: "Revisá el celular: con código de área, por ejemplo 223 555-0100." };
  if ((access || summary) && user.role !== "admin") return { ok: false, message: "El acceso total y el resumen diario los habilita Turnia: pedíselo." };
  if (summary && !access) return { ok: false, message: "El resumen diario va con el acceso total: así le pueden preguntar a Sofi por cada turno." };
  if (!events.length && !access) return { ok: false, message: "Elegí qué recibe: avisos de turnos o acceso total." };
  if (events.length) {
    await sql`
      insert into clinic_notice_phones (clinic_id, phone, name, events) values (${clinic.id}, ${phone}, ${name}, ${events})
      on conflict (clinic_id, phone) do update set name = excluded.name, events = excluded.events`;
  }
  if (access) {
    await sql`
      insert into clinic_staff_phones (clinic_id, phone, name, daily_summary) values (${clinic.id}, ${phone}, ${name}, ${summary})
      on conflict (clinic_id, phone) do update set name = excluded.name, daily_summary = excluded.daily_summary`;
    // Las conversaciones abiertas de ese número arrancan de nuevo con el acceso del equipo.
    await touchClinic(clinic.id, "Acceso total por WhatsApp");
  }
  revalidatePath("/panel/configuracion", "layout");
  const what = [events.length && "los avisos de turnos", access && "acceso total por WhatsApp", summary && "el resumen de las 10"].filter(Boolean);
  return { ok: true, message: `Listo: ${name} recibe ${what.length > 1 ? `${what.slice(0, -1).join(", ")} y ${what.at(-1)}` : what[0]}.${events.length ? " Mandale un aviso de prueba para confirmar que llega." : ""}` };
}

/** Quitar a alguien de la lista: deja de recibir avisos y, si lo quita Turnia, pierde el acceso total. */
export async function removeTeamMember(form: FormData): Promise<void> {
  const user = await requirePanelSession();
  const clinic = await getPanelClinic(form);
  const phone = normalizePhone(text(form, "phone"));
  if (!/^\d{8,15}$/.test(phone)) return;
  await sql`delete from clinic_notice_phones where clinic_id = ${clinic.id} and phone = ${phone}`;
  if (user.role === "admin") {
    const removed = await sql`delete from clinic_staff_phones where clinic_id = ${clinic.id} and phone = ${phone} returning id`;
    if (removed.length) await touchClinic(clinic.id, "Acceso total por WhatsApp");
  }
  revalidatePath("/panel/configuracion", "layout");
}

/** Equipo por WhatsApp → pausa automática: Sofi se pausa en un chat cuando el equipo contesta desde el celular. */
export async function setAutoPause(form: FormData): Promise<void> {
  await requirePanelSession();
  const clinic = await getPanelClinic(form);
  await sql`update clinics set auto_pause_on_staff_reply = ${form.get("on") === "1"} where id = ${clinic.id}`;
  revalidatePath("/panel/configuracion", "layout");
}
