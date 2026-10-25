"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/panel-clinic";
import { SheetError, connectSheet, disconnectSheet, syncLeadsToSheet } from "@/lib/leads-sheet";

export type SheetState = { ok: boolean; message: string } | undefined;

/** Guarda la URL de la aplicación web de la planilla y prueba que responda. */
export async function connectSheetAction(_prev: SheetState, form: FormData): Promise<SheetState> {
  await requireAdmin();
  try {
    const { name } = await connectSheet(String(form.get("url") ?? ""));
    revalidatePath("/panel/demos", "layout");
    return { ok: true, message: `Conectada con «${name}». Los pedidos nuevos se copian solos.` };
  } catch (e) {
    if (e instanceof SheetError) return { ok: false, message: e.message };
    throw e;
  }
}

/** Copia todos los pedidos que ya hay (o los actualiza, si ya estaban). */
export async function syncAllLeadsAction(): Promise<SheetState> {
  await requireAdmin();
  const result = await syncLeadsToSheet("all");
  revalidatePath("/panel/demos", "layout");
  return result.ok
    ? { ok: true, message: `Listo: ${result.count} ${result.count === 1 ? "pedido copiado" : "pedidos copiados"} en la planilla.` }
    : { ok: false, message: result.error ?? "No se pudo copiar." };
}

export async function disconnectSheetAction(): Promise<SheetState> {
  await requireAdmin();
  await disconnectSheet();
  revalidatePath("/panel/demos", "layout");
  return { ok: true, message: "Planilla desconectada. Los pedidos siguen en Turnia." };
}
