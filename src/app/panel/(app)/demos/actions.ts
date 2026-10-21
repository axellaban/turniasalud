"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { sql } from "@/lib/db";
import { isLeadStatus } from "@/lib/leads";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/session";

export type LeadFormState = { ok?: boolean; message?: string };

async function requireSession() {
  const store = await cookies();
  if (!verifySessionToken(store.get(SESSION_COOKIE)?.value)) redirect("/panel/login");
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
