import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { getClinic, isUuid } from "./clinic";
import { activeClinicAccess } from "./clinic-access";
import { SESSION_COOKIE, readSessionToken } from "./session";
import type { Clinic } from "./types";

export const CLINIC_COOKIE = "turnia_clinic";

/** Quién usa el panel: el administrador de Turnia o un consultorio con su código. */
export type PanelUser =
  | { role: "admin" }
  | { role: "clinic"; accessId: string; clinicId: string; label: string | null };

// Una página llama varias veces a la sesión y a la clínica (encabezado, menú y contenido):
// `cache` las lee una sola vez por pedido. Fuera del render no guarda nada.
export const getPanelUser = cache(async (): Promise<PanelUser> => {
  const claims = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) redirect("/panel/login");
  if (claims.role === "admin") return claims;
  // Un acceso revocado (o de una clínica borrada) deja de valer en el acto.
  const access = await activeClinicAccess(claims.accessId);
  if (!access) redirect("/panel/login?error=revoked");
  return { role: "clinic", accessId: access.id, clinicId: access.clinic_id, label: access.label };
});

export async function requirePanelSession(): Promise<PanelUser> {
  return getPanelUser();
}

/** Clínicas, pedidos de demo, canal, agente y sistema: solo el administrador. */
export async function requireAdmin(): Promise<void> {
  if ((await getPanelUser()).role !== "admin") redirect("/panel");
}

const selectedClinic = cache(async (): Promise<Clinic> => {
  const user = await getPanelUser();
  let clinic: Clinic | undefined;
  if (user.role === "clinic") {
    // El consultorio siempre trabaja sobre su propia clínica, sin importar la cookie de selección.
    [clinic] = await sql<Clinic[]>`select * from clinics where id = ${user.clinicId}`;
    if (!clinic) redirect("/panel/login?error=revoked");
  } else {
    const id = (await cookies()).get(CLINIC_COOKIE)?.value;
    if (isUuid(id)) [clinic] = await sql<Clinic[]>`select * from clinics where id = ${id}`;
    clinic ??= await getClinic();
  }
  return clinic;
});

/** Selección exclusiva del administrador. Nunca usarla para resolver webhooks. */
export async function getPanelClinic(form?: FormData): Promise<Clinic> {
  const clinic = await selectedClinic();
  const posted = form?.get("clinic_id");
  if (posted && posted !== clinic.id) throw new Error("La clínica seleccionada cambió. Recargá la pantalla antes de guardar.");
  return clinic;
}

/** Marca la ficha como modificada; con `area`, además queda en el historial quién la cambió. */
export async function touchClinic(id: string, area?: string): Promise<void> {
  await sql`update clinics set retained_at = coalesce(retained_at, now()), updated_at = now(), context_revision = context_revision + 1 where id = ${id}`;
  if (area) await logClinicChange(id, area);
}

export type ClinicChange = { actor: string; area: string; created_at: string };

export async function logClinicChange(clinicId: string, area: string): Promise<void> {
  const user = await getPanelUser();
  const actor = user.role === "admin" ? "Turnia" : user.label || "El consultorio";
  // Cambios seguidos del mismo autor en la misma sección cuentan una sola vez.
  const [recent] = await sql`
    update clinic_changes set created_at = now()
    where id = (select id from clinic_changes where clinic_id = ${clinicId} order by created_at desc limit 1)
      and actor = ${actor} and area = ${area} and created_at > now() - interval '10 minutes'
    returning id`;
  if (!recent) await sql`insert into clinic_changes (clinic_id, actor, area) values (${clinicId}, ${actor}, ${area})`;
}

export async function recentClinicChanges(clinicId: string, limit = 6): Promise<ClinicChange[]> {
  return sql<ClinicChange[]>`select actor, area, created_at from clinic_changes where clinic_id = ${clinicId} order by created_at desc limit ${limit}`;
}
