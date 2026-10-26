"use server";

import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/panel-clinic";
import { queueTurniaSheetSync } from "@/lib/sheets/turnia-sheet";
import { parseOutreachImport } from "@/lib/sales/outreach-import";
import {
  CHANNELS,
  OUTREACH_STATUSES,
  PHONE_KINDS,
  TEMPLATE_KEYS,
  normalizeInstagram,
  outreachPhone,
  type OutreachChannel,
  type OutreachStatus,
  type PhoneKind,
} from "@/lib/sales/outreach-messages";
import {
  OutreachError,
  addOutreachNote,
  importOutreach,
  recordTouch,
  saveOutreachSettings,
  setOutreachStatus,
  undoLastTouch,
  updateOutreach,
  type OutreachEdit,
} from "@/lib/sales/outreach";

export type ActionState = { ok: boolean; message: string } | undefined;

const text = (form: FormData, name: string) => String(form.get(name) ?? "").trim();
const fail = (e: unknown): ActionState => {
  if (e instanceof OutreachError) return { ok: false, message: e.message };
  throw e;
};

/** Después de cada cambio: el panel se refresca y la planilla de Google (si hay una) se copia de nuevo. */
function refresh(id?: string) {
  revalidatePath("/panel/prospeccion");
  if (id) revalidatePath(`/panel/prospeccion/${id}`);
  queueTurniaSheetSync();
}

/** Le escribió (o lo llamó, o lo visitó): suma el contacto y programa el seguimiento. */
export async function touchAction(form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = text(form, "id");
  const channel = text(form, "channel") as OutreachChannel;
  if (!(CHANNELS as readonly string[]).includes(channel)) return { ok: false, message: "Canal desconocido." };
  try {
    await recordTouch(id, channel, { before: form.get("before") === "1" });
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  return { ok: true, message: "Listo." };
}

/** Deshace el último contacto: una prueba o un chat que se abrió y no se mandó. */
export async function undoTouchAction(form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = text(form, "id");
  try {
    await undoLastTouch(id);
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  return { ok: true, message: "Listo." };
}

export async function statusAction(form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = text(form, "id");
  const status = text(form, "status") as OutreachStatus;
  if (!(OUTREACH_STATUSES as readonly string[]).includes(status)) return { ok: false, message: "Estado desconocido." };
  try {
    await setOutreachStatus(id, status, text(form, "detail").slice(0, 300));
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  return { ok: true, message: "Listo." };
}

export async function updateOutreachAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = text(form, "id");
  const rawPhone = text(form, "phone");
  const kindRaw = text(form, "phone_kind");
  const kind: PhoneKind = (PHONE_KINDS as readonly string[]).includes(kindRaw) ? (kindRaw as PhoneKind) : "movil";
  const phone = rawPhone ? outreachPhone(rawPhone, kind) : null;
  if (rawPhone && !phone) return { ok: false, message: "Revisá el teléfono: código de área y número, por ejemplo 223 512-3456." };
  const rawInstagram = text(form, "instagram");
  const instagram = normalizeInstagram(rawInstagram);
  if (rawInstagram && !instagram) return { ok: false, message: "Revisá el Instagram: el usuario (por ejemplo @dra.perez) o el link de su perfil." };
  const rawWebsite = text(form, "website");
  let website: string | null = null;
  if (rawWebsite) {
    try {
      website = new URL(/^https?:\/\//i.test(rawWebsite) ? rawWebsite : `https://${rawWebsite}`).toString();
    } catch {
      return { ok: false, message: "Revisá la web." };
    }
  }
  const email = text(form, "email");
  if (email && !/^[^\s@]{1,64}@[^\s@]{1,190}\.[a-z]{2,24}$/i.test(email)) return { ok: false, message: "Revisá el email." };
  const next = text(form, "next_action_on");
  if (next && !/^\d{4}-\d{2}-\d{2}$/.test(next)) return { ok: false, message: "Revisá la fecha del próximo paso." };
  const title = text(form, "title");
  const edit: OutreachEdit = {
    name: text(form, "name"),
    greeting: text(form, "greeting").slice(0, 60),
    title: title === "Dr." || title === "Dra." ? title : "",
    business_name: text(form, "business_name").slice(0, 160),
    zone: text(form, "zone").slice(0, 80),
    address: text(form, "address").slice(0, 200),
    specialty: text(form, "specialty").slice(0, 200),
    phone: phone?.phone ?? null,
    phone_kind: phone?.kind ?? null,
    instagram,
    email: email ? email.toLowerCase() : null,
    website,
    notes: text(form, "notes").slice(0, 4000),
    next_action_on: next || null,
    priority: Number(text(form, "priority")) || 2,
  };
  try {
    await updateOutreach(id, edit);
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  return { ok: true, message: "Guardado." };
}

export async function noteAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const id = text(form, "id");
  try {
    await addOutreachNote(id, text(form, "note"));
  } catch (e) {
    return fail(e);
  }
  refresh(id);
  return { ok: true, message: "Nota guardada." };
}

export type ImportState = { ok: boolean; message: string; created?: number; updated?: number } | undefined;

export async function importOutreachAction(_prev: ImportState, form: FormData): Promise<ImportState> {
  await requireAdmin();
  const raw = text(form, "text");
  if (!raw) return { ok: false, message: "Pegá la lista o elegí el archivo." };
  if (raw.length > 3_000_000) return { ok: false, message: "El archivo es muy grande: dividilo en partes." };
  const preview = parseOutreachImport(raw);
  if (!preview.rows.length) return { ok: false, message: preview.problems[0]?.reason ?? "No encontramos filas para importar." };
  const overwrite = form.get("actualizar") === "1";
  const result = await importOutreach(preview.rows, { overwrite });
  refresh();
  const already = overwrite ? "con los datos del archivo" : "solo se completó lo que faltaba";
  return {
    ok: true,
    message: `Listo: ${result.created} ${result.created === 1 ? "persona nueva" : "personas nuevas"}${result.updated ? ` y ${result.updated} que ya estaban (${already})` : ""}.`,
    ...result,
  };
}

export async function saveTemplatesAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  const templates = Object.fromEntries(TEMPLATE_KEYS.map((key) => [key, String(form.get(key) ?? "")]));
  try {
    await saveOutreachSettings({ templates, daily_goal: Number(text(form, "daily_goal")), weekly_goal: Number(text(form, "weekly_goal")) });
  } catch (e) {
    return fail(e);
  }
  refresh();
  revalidatePath("/panel/prospeccion/mensajes");
  return { ok: true, message: "Mensajes guardados." };
}
