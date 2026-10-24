"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { isLeadStatus } from "@/lib/leads";
import { SESSION_COOKIE, isAdminSessionToken } from "@/lib/session";

export type LeadFormState = { ok?: boolean; message?: string };

async function requireSession() {
  const store = await cookies();
  if (!isAdminSessionToken(store.get(SESSION_COOKIE)?.value)) redirect("/panel/login");
}

// Los pedidos comerciales pertenecen a esta web y los gestiona su único
// administrador. No son pacientes ni están asociados a una clínica demo.
export async function updateLead(_prev: LeadFormState | undefined, form: FormData): Promise<LeadFormState> {
  await requireSession();
  const id = form.get("id");
  const status = form.get("status");
  const notes = form.get("notes");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) ||
      !isLeadStatus(status) || typeof notes !== "string" || notes.length > 2000) {
    return { ok: false, message: "Revisá el estado y las notas (hasta 2.000 caracteres)." };
  }
  try {
    const rows = await sql`
      update leads set status = ${status}, notes = ${notes.trim() || null}, updated_at = now()
      where id = ${id} returning id`;
    if (!rows.length) return { ok: false, message: "El pedido ya no está disponible." };
    revalidatePath("/panel/demos");
    return { ok: true, message: "Seguimiento guardado." };
  } catch {
    return { ok: false, message: "No pudimos guardar el seguimiento. Probá de nuevo." };
  }
}

/**
 * Borra un pedido (por ejemplo, una prueba propia) con sus demos. Las fichas
 * temporales que se armaron para esas demos se van con él; las conservadas
 * desde Clínicas quedan, porque ya son perfiles en uso.
 */
export async function deleteLead(form: FormData): Promise<void> {
  await requireSession();
  const id = form.get("id");
  if (typeof id !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) throw new Error("Pedido inválido.");
  await sql.begin(async (tx) => {
    const sessions = await tx<{ clinic_id: string | null }[]>`delete from demo_sessions where lead_id = ${id} returning clinic_id`;
    const clinics = [...new Set(sessions.map((x) => x.clinic_id).filter((x): x is string => Boolean(x)))];
    if (clinics.length) {
      await tx`
        delete from clinics where id in ${tx(clinics)} and is_demo and retained_at is null
          and not exists (select 1 from demo_sessions ds where ds.clinic_id = clinics.id)`;
    }
    await tx`delete from leads where id = ${id}`;
  });
  revalidatePath("/panel", "layout");
}
