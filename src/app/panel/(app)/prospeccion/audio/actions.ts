"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/panel-clinic";
import { queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";
import { OutreachError } from "@/lib/sales/outreach";
import { audioMimetype, deleteVoiceNote, saveVoiceNote, sendVoiceTest, sendVoiceToProspect } from "@/lib/sales/voice-outreach";

export type VoiceResult = { ok: boolean; message: string; id?: string };

const fail = (e: unknown): VoiceResult => {
  if (e instanceof OutreachError) return { ok: false, message: e.message };
  console.error("Audio de prospección", e instanceof Error ? e.message : e);
  return { ok: false, message: e instanceof Error ? e.message.slice(0, 300) : "No se pudo mandar." };
};

export async function uploadVoiceAction(_prev: VoiceResult | undefined, form: FormData): Promise<VoiceResult> {
  await requireAdmin();
  const file = form.get("audio");
  if (!(file instanceof File) || !file.size) return { ok: false, message: "Elegí el archivo del audio." };
  const mimetype = audioMimetype(file.type, file.name);
  if (!mimetype) return { ok: false, message: "Ese archivo no parece un audio (.ogg, .opus, .m4a, .mp3 o .webm)." };
  try {
    const id = await saveVoiceNote(String(form.get("label") ?? ""), mimetype, Buffer.from(await file.arrayBuffer()));
    revalidatePath("/panel/prospeccion/audio");
    return { ok: true, message: "Audio guardado. Probalo primero mandándotelo a vos.", id };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteVoiceAction(form: FormData): Promise<void> {
  await requireAdmin();
  await deleteVoiceNote(String(form.get("id") ?? ""));
  revalidatePath("/panel/prospeccion/audio");
}

export async function testVoiceAction(noteId: string, phone: string, text: string, seconds: number): Promise<VoiceResult> {
  await requireAdmin();
  try {
    const sentTo = await sendVoiceTest(noteId, phone, text, seconds);
    return { ok: true, message: `Salió a ${sentTo}. Fijate que llegue como nota de voz (con la onda azul) y sin «Reenviado».` };
  } catch (e) {
    return fail(e);
  }
}

export async function sendVoiceAction(noteId: string, outreachId: string, text: string, seconds: number): Promise<VoiceResult> {
  await requireAdmin();
  try {
    const { name } = await sendVoiceToProspect(noteId, outreachId, text, seconds);
    revalidatePath("/panel/prospeccion");
    queueTurniaSheetSync();
    return { ok: true, message: `Salió a ${name}.` };
  } catch (e) {
    return fail(e);
  }
}
