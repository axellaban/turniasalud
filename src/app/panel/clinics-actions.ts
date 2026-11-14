"use server";

import { cookies } from "next/headers";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { getClinic, isUuid } from "@/lib/clinic";
import { applyDentalTemplate } from "@/lib/dental-template";
import { DENTAL_SPECIALTY, isDentalSpecialty } from "@/lib/agent/modules/odontologia";
import { CLINIC_COOKIE, getPanelClinic, logClinicChange, requireAdmin, touchClinic } from "@/lib/panel-clinic";
import { createClinicAccess, revokeClinicAccess } from "@/lib/clinic-access";
import { sessionCookieOptions } from "@/lib/session";
import { normalizeWebsite } from "@/lib/demo/website";
import { applyClinicImport, readClinicImport, requestClinicImport } from "@/lib/clinic-imports";
import { createProfileHandoff } from "@/lib/demo/handoff";
import { messagingSettings } from "@/lib/messaging-settings";
import { demoWhatsappNumber } from "@/lib/demo/config";
import { qrSvg } from "@/lib/agent-test";
import type { FormState } from "./actions";

export async function selectClinic(form: FormData): Promise<void> {
  await requireAdmin();
  const id = String(form.get("clinic_id") ?? "");
  if (!isUuid(id) || !(await sql`select id from clinics where id = ${id}`).length) throw new Error("Esta clínica ya no está disponible.");
  (await cookies()).set(CLINIC_COOKIE, id, sessionCookieOptions);
  revalidatePath("/panel", "layout");
  // El selector del encabezado se queda en la misma sección; las tarjetas de Clínicas abren la configuración.
  const back = String(form.get("return_to") ?? "");
  redirect(/^\/panel(\/[a-z]+){0,2}$/.test(back) && !back.startsWith("/panel/login") ? back : "/panel/configuracion");
}

export async function createClinic(_previous: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  const name = String(form.get("name") ?? "").trim().slice(0, 120);
  const input = String(form.get("website") ?? "").trim();
  const website = input ? normalizeWebsite(input) : null;
  if (!name) return { ok: false, message: "Ingresá el nombre de la clínica." };
  if (input && !website) return { ok: false, message: "Revisá la dirección de la web." };
  const main = await getClinic();
  const specialty = String(form.get("specialty") ?? "Consultorio").trim().slice(0, 80) || "Consultorio";
  const [clinic] = await sql`insert into clinics (name, specialty, agent_name, timezone, website, is_demo, retained_at, urgency_instructions)
    values (${name}, ${specialty}, ${main.agent_name}, ${main.timezone}, ${website}, true, now(), ${main.urgency_instructions}) returning id`;
  // Un consultorio odontológico arranca con las prestaciones de la plantilla (se confirman en el setup).
  if (isDentalSpecialty(specialty)) await applyDentalTemplate(clinic.id, DENTAL_SPECIALTY);
  (await cookies()).set(CLINIC_COOKIE, clinic.id, sessionCookieOptions);
  revalidatePath("/panel", "layout");
  redirect("/panel/configuracion");
}

/** Borra una ficha de demo con su agenda, pacientes e historial. La clínica principal nunca se borra. */
export async function deleteClinic(form: FormData): Promise<void> {
  await requireAdmin();
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
  await requireAdmin();
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

export type ProfileTestState = FormState & { url?: string; qr?: string };

/**
 * Enlace para probar esta ficha por chat: abre el WhatsApp general con la ficha de la
 * clínica (chat, audios o que lo llame). Sirve para las demos y para los consultorios: con un
 * consultorio, lo que reserve queda en su agenda real. No vence nunca y se puede usar varias veces.
 */
export async function prepareTestLink(_previous: ProfileTestState, form: FormData): Promise<ProfileTestState> {
  const clinic = await getPanelClinic(form);
  if ((await messagingSettings()).active_channel !== "whatsapp") return { ok: false, message: "El WhatsApp de prueba no está activo en este momento." };
  const wa = (await demoWhatsappNumber()).number;
  if (!wa) return { ok: false, message: "El WhatsApp no está disponible en este momento." };
  // Probar una demo la conserva; con un consultorio no cambia nada de su ficha.
  if (clinic.is_demo) await touchClinic(clinic.id);
  const token = await createProfileHandoff(clinic.id, clinic.website);
  const url = `https://wa.me/${wa}?text=${encodeURIComponent(`¡Hola! Quiero probar este perfil de Turnia: ${token}`)}`;
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, url, qr: await qrSvg(url), message: "Enlace listo: no vence y lo podés usar las veces que quieras." };
}

export async function refreshClinic(_previous: FormState, form: FormData): Promise<FormState> {
  const clinic = await getPanelClinic(form);
  const website = normalizeWebsite(clinic.website);
  if (!website) return { ok: false, message: "Guardá primero una web válida en la ficha." };
  try {
    const id = await requestClinicImport(clinic.id, website);
    after(async () => { await readClinicImport(id); });
    revalidatePath("/panel/configuracion", "layout");
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
    await logClinicChange(clinic.id, "Datos leídos de la web");
    revalidatePath("/panel", "layout");
    return { ok: true, message: "Se aplicaron únicamente los datos elegidos. Las conversaciones nuevas usarán la ficha actualizada." };
  } catch (e) { return { ok: false, message: e instanceof Error ? e.message : "No se pudo aplicar la propuesta." }; }
}

export async function discardImport(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  const id = String(form.get("import_id") ?? "");
  if (isUuid(id)) await sql`update clinic_imports set status = 'discarded' where id = ${id} and clinic_id = ${clinic.id} and status = 'pending'`;
  revalidatePath("/panel/configuracion", "layout");
}

export type AccessState = FormState & { code?: string };

/** Crea el código de acceso del consultorio. Se muestra una sola vez. */
export async function createAccess(_previous: AccessState, form: FormData): Promise<AccessState> {
  await requireAdmin();
  const clinic = await getPanelClinic(form);
  const label = String(form.get("label") ?? "").trim().slice(0, 80) || null;
  const { code } = await createClinicAccess(clinic.id, label);
  revalidatePath("/panel/configuracion", "layout");
  return { ok: true, code, message: "Copiá el código ahora: por seguridad no se vuelve a mostrar." };
}

export async function revokeAccess(form: FormData): Promise<void> {
  await requireAdmin();
  const clinic = await getPanelClinic(form);
  const id = String(form.get("access_id") ?? "");
  if (isUuid(id)) await revokeClinicAccess(clinic.id, id);
  revalidatePath("/panel/configuracion", "layout");
}
