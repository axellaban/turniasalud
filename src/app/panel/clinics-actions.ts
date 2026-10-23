"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getClinic, isUuid } from "@/lib/clinic";
import { CLINIC_COOKIE, getPanelClinic, requirePanelSession, touchClinic } from "@/lib/panel-clinic";
import { sessionCookieOptions } from "@/lib/session";
import { normalizeWebsite } from "@/lib/demo/website";
import { applyClinicImport, readClinicImport, requestClinicImport } from "@/lib/clinic-imports";
import { createProfileHandoff } from "@/lib/demo/handoff";
import { messagingSettings } from "@/lib/messaging-settings";
import { TELEGRAM_BOT_USERNAME } from "@/lib/telegram";
import { demoWhatsappNumber } from "@/lib/demo/config";
import type { FormState } from "./actions";

export async function selectClinic(form: FormData): Promise<void> {
  await requirePanelSession();
  const id = String(form.get("clinic_id") ?? "");
  if (!isUuid(id) || !(await sql`select id from clinics where id = ${id}`).length) throw new Error("Esta clínica ya no está disponible.");
  (await cookies()).set(CLINIC_COOKIE, id, sessionCookieOptions);
  revalidatePath("/panel", "layout");
  redirect("/panel/configuracion");
}

export async function createClinic(_previous: FormState, form: FormData): Promise<FormState> {
  await requirePanelSession();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const input = String(form.get("website") ?? "").trim();
  const website = input ? normalizeWebsite(input) : null;
  if (!name) return { ok: false, message: "Ingresá el nombre de la clínica." };
  if (input && !website) return { ok: false, message: "Revisá la dirección de la web." };
  const main = await getClinic();
  const [clinic] = await sql`insert into clinics (name, specialty, agent_name, timezone, website, is_demo, retained_at, urgency_instructions)
    values (${name}, ${String(form.get("specialty") ?? "Consultorio").trim().slice(0, 80) || "Consultorio"}, ${main.agent_name}, ${main.timezone}, ${website}, true, now(), ${main.urgency_instructions}) returning id`;
  (await cookies()).set(CLINIC_COOKIE, clinic.id, sessionCookieOptions);
  revalidatePath("/panel", "layout");
  redirect("/panel/configuracion");
}

/** Borra una ficha de demo con su agenda, pacientes e historial. La clínica principal nunca se borra. */
export async function deleteClinic(form: FormData): Promise<void> {
  await requirePanelSession();
  const id = String(form.get("clinic_id") ?? "");
  if (!isUuid(id)) throw new Error("Clínica inválida.");
  const [deleted] = await sql`delete from clinics where id = ${id} and is_demo returning id`;
  if (!deleted) throw new Error("Solo se pueden borrar fichas de demo.");
  const store = await cookies();
  if (store.get(CLINIC_COOKIE)?.value === id) store.delete(CLINIC_COOKIE);
  revalidatePath("/panel", "layout");
}

/** Borra todas las demos temporales; las conservadas y la principal quedan. */
export async function deleteTemporaryDemos(): Promise<void> {
  await requirePanelSession();
  const deleted = await sql<{ id: string }[]>`delete from clinics where is_demo and retained_at is null returning id`;
  const store = await cookies();
  if (deleted.some((c) => c.id === store.get(CLINIC_COOKIE)?.value)) store.delete(CLINIC_COOKIE);
  revalidatePath("/panel", "layout");
}

export async function retainClinic(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  await touchClinic(clinic.id);
  revalidatePath("/panel", "layout");
}

export type ProfileTestState = FormState & { url?: string };
export async function launchProfile(_previous: ProfileTestState, form: FormData): Promise<ProfileTestState> {
  const clinic = await getPanelClinic(form);
  if (!clinic.is_demo) return { ok: false, message: "La clínica principal se prueba desde la demo privada del panel." };
  const settings = await messagingSettings();
  if (settings.active_channel === "pausado") return { ok: false, message: "Elegí Telegram o WhatsApp en la configuración general para probar por chat." };
  if (settings.active_channel === "telegram" && !settings.telegram_ready) return { ok: false, message: "Primero conectá el bot en la configuración general." };
  const wa = settings.active_channel === "whatsapp" ? (await demoWhatsappNumber()).number : null;
  if (settings.active_channel === "whatsapp" && !wa) return { ok: false, message: "WhatsApp no está disponible. La conexión existente se conserva." };
  await touchClinic(clinic.id);
  const token = await createProfileHandoff(clinic.id, clinic.website);
  const url = settings.active_channel === "telegram"
    ? `https://t.me/${TELEGRAM_BOT_USERNAME}?start=${token}`
    : `https://wa.me/${wa}?text=${encodeURIComponent(`¡Hola! Quiero probar este perfil de Turnia: ${token}`)}`;
  revalidatePath("/panel/configuracion");
  return { ok: true, url, message: "Enlace listo por 7 días; podés usarlo varias veces. Usa esta ficha guardada, sin volver a leer la web." };
}

export async function refreshClinic(_previous: FormState, form: FormData): Promise<FormState> {
  const clinic = await getPanelClinic(form);
  const website = normalizeWebsite(clinic.website);
  if (!website) return { ok: false, message: "Guardá primero una web válida en la ficha." };
  try {
    const id = await requestClinicImport(clinic.id, website);
    after(async () => { await readClinicImport(id); });
    revalidatePath("/panel/configuracion");
    return { ok: true, message: "Leyendo la web. La ficha actual se conserva; después elegís qué datos aplicar." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "No se pudo iniciar la lectura." }; }
}

export async function applyImport(_previous: FormState, form: FormData): Promise<FormState> {
  const clinic = await getPanelClinic(form);
  const id = String(form.get("import_id") ?? "");
  const revision = Number(form.get("revision"));
  if (!isUuid(id) || !Number.isSafeInteger(revision)) return { ok: false, message: "Revisión inválida. Recargá la página." };
  try {
    await applyClinicImport(clinic.id, id, form.getAll("fields").filter((v): v is string => typeof v === "string"), revision);
    revalidatePath("/panel", "layout");
    return { ok: true, message: "Se aplicaron únicamente los datos elegidos. Las conversaciones nuevas usarán la ficha actualizada." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "No se pudo aplicar la propuesta." }; }
}

export async function discardImport(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  const id = String(form.get("import_id") ?? "");
  if (isUuid(id)) await sql`update clinic_imports set status = 'discarded' where id = ${id} and clinic_id = ${clinic.id} and status = 'pending'`;
  revalidatePath("/panel/configuracion");
}
