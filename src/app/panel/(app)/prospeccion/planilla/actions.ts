"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/panel-clinic";
import { disconnectTurniaSheet, recreateTurniaSheet, syncTurniaSheet } from "@/lib/sheets/turnia-sheet";

export type PlanillaState = { ok: boolean; message: string } | undefined;

const PAGE = "/panel/prospeccion/planilla";

/** Copia todo ahora (además de la copia que se hace sola con cada cambio). */
export async function syncNowAction(): Promise<PlanillaState> {
  await requireAdmin();
  const result = await syncTurniaSheet();
  revalidatePath(PAGE);
  return result.ok ? { ok: true, message: "Listo: la planilla está al día." } : { ok: false, message: result.error ?? "No se pudo copiar." };
}

/** La planilla se borró: crea otra en el mismo Drive y copia todo. */
export async function recreateAction(): Promise<PlanillaState> {
  await requireAdmin();
  const result = await recreateTurniaSheet();
  revalidatePath(PAGE);
  return result.ok ? { ok: true, message: "Listo: hay una planilla nueva en tu Drive, con todo copiado." } : { ok: false, message: result.error ?? "No se pudo crear." };
}

export async function disconnectAction(): Promise<PlanillaState> {
  await requireAdmin();
  await disconnectTurniaSheet();
  revalidatePath(PAGE);
  return { ok: true, message: "Desconectada. La planilla queda en tu Drive, pero ya no se actualiza." };
}
