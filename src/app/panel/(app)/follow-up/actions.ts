"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/panel-clinic";
import { queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";
import { FollowupError, createFollowupVersion, markFollowup, prepareFollowup, setFollowupVersionStatus } from "@/lib/sales/followup";

type Result<T> = { ok: true; data: T } | { ok: false; message: string };

async function run<T>(work: () => Promise<T>): Promise<Result<T>> {
  await requireAdmin();
  try {
    return { ok: true, data: await work() };
  } catch (e) {
    if (e instanceof FollowupError) return { ok: false, message: e.message };
    throw e;
  }
}

/** «Ejecutar»: el mensaje armado para esa persona. No registra nada. */
export async function prepareFollowupAction(id: string, stage: string) {
  return run(() => prepareFollowup(id, stage));
}

/** «Abrir WhatsApp», «Confirmar envío» o «No se envió». */
export async function markFollowupAction(input: { id: string; stage: string; versionId: string; status: string; reason?: string }) {
  const result = await run(() => markFollowup(input));
  if (result.ok && input.status === "sent") {
    revalidatePath("/panel/prospeccion");
    revalidatePath(`/panel/prospeccion/${input.id}`);
    queueTurniaSheetSync();
  }
  return result;
}

export async function createFollowupVersionAction(input: { stage: string; channel: string; trigger: string; body: string; ctas: string[]; status: string }) {
  const result = await run(() => createFollowupVersion(input));
  if (result.ok) revalidatePath("/panel/follow-up");
  return result;
}

export async function setFollowupVersionStatusAction(id: string, status: string) {
  const result = await run(() => setFollowupVersionStatus(id, status));
  if (result.ok) revalidatePath("/panel/follow-up");
  return result;
}
