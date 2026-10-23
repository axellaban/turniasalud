import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { sql } from "./db";
import { getClinic, isUuid } from "./clinic";
import { SESSION_COOKIE, verifySessionToken } from "./session";
import type { Clinic } from "./types";

export const CLINIC_COOKIE = "turnia_clinic";

export async function requirePanelSession(): Promise<void> {
  if (!verifySessionToken((await cookies()).get(SESSION_COOKIE)?.value)) redirect("/panel/login");
}

/** Selección exclusiva del administrador. Nunca usarla para resolver webhooks. */
export async function getPanelClinic(form?: FormData): Promise<Clinic> {
  await requirePanelSession();
  const id = (await cookies()).get(CLINIC_COOKIE)?.value;
  let clinic: Clinic | undefined;
  if (isUuid(id)) [clinic] = await sql<Clinic[]>`select * from clinics where id = ${id}`;
  clinic ??= await getClinic();
  const posted = form?.get("clinic_id");
  if (posted && posted !== clinic.id) throw new Error("La clínica seleccionada cambió. Recargá la pantalla antes de guardar.");
  return clinic;
}

export async function touchClinic(id: string): Promise<void> {
  await sql`update clinics set retained_at = coalesce(retained_at, now()), updated_at = now(), context_revision = context_revision + 1 where id = ${id}`;
}
