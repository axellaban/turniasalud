import "server-only";
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

export async function getPanelUser(): Promise<PanelUser> {
  const claims = readSessionToken((await cookies()).get(SESSION_COOKIE)?.value);
  if (!claims) redirect("/panel/login");
  if (claims.role === "admin") return claims;
  // Un acceso revocado (o de una clínica borrada) deja de valer en el acto.
  const access = await activeClinicAccess(claims.accessId);
  if (!access) redirect("/panel/login?error=revoked");
  return { role: "clinic", accessId: access.id, clinicId: access.clinic_id, label: access.label };
}

export async function requirePanelSession(): Promise<PanelUser> {
  return getPanelUser();
}

/** Clínicas, pedidos de demo, canal, agente y sistema: solo el administrador. */
export async function requireAdmin(): Promise<void> {
  if ((await getPanelUser()).role !== "admin") redirect("/panel");
}

/** Selección exclusiva del administrador. Nunca usarla para resolver webhooks. */
export async function getPanelClinic(form?: FormData): Promise<Clinic> {
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
  const posted = form?.get("clinic_id");
  if (posted && posted !== clinic.id) throw new Error("La clínica seleccionada cambió. Recargá la pantalla antes de guardar.");
  return clinic;
}

export async function touchClinic(id: string): Promise<void> {
  await sql`update clinics set retained_at = coalesce(retained_at, now()), updated_at = now(), context_revision = context_revision + 1 where id = ${id}`;
}
