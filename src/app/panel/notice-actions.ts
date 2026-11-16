"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/clinic";
import { NOTICE_KINDS, sendTestNotice, type NoticeKind } from "@/lib/clinic-notices";
import { sql } from "@/lib/db";
import { getPanelClinic } from "@/lib/panel-clinic";
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
