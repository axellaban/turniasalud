"use server";

import { revalidatePath } from "next/cache";
import { isUuid } from "@/lib/clinic";
import { getPanelClinic, logClinicChange, requireAdmin } from "@/lib/panel-clinic";
import {
  getSmileApiConnection,
  linkSmileProfessional,
  pullSmileConnect,
  recordSmileError,
  removeSmileApiKey,
  saveSmileApiKey,
  setSmileMode,
  SMILE_MODE_LABEL,
  SMILE_MODES,
  WRITE_MODES,
  type SmileMode,
} from "@/lib/smile-connect-link";
import { dismissSmileReview, resumeSmileWrites } from "@/lib/smile-connect-push";
import type { FormState } from "./actions";

// Configuración → Calendario → Smile Connect por API. La clave y el modo los cambia solo Turnia
// (es la agenda real del consultorio); sincronizar y marcar lo revisado, también el consultorio.

const PAGE = "/panel/configuracion/calendario";
const text = (form: FormData, key: string) => {
  const value = form.get(key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
};
const failed = (e: unknown, fallback: string): FormState => ({ ok: false, message: e instanceof Error ? e.message : fallback });

export async function saveSmileApiKeyAction(_previous: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    const clinic = await getPanelClinic(form);
    const key = text(form, "api_key");
    if (!key) return { ok: false, message: "Pegá la clave de la API de Smile Connect." };
    const check = await saveSmileApiKey(clinic.id, key);
    await logClinicChange(clinic.id, "Calendario");
    revalidatePath(PAGE);
    const pros = check.professionals.map((p) => `${p.name} → ${p.turnia ?? "sin vincular (se crea al sincronizar)"}`).join("; ");
    return {
      ok: true,
      message: `Clave guardada: es de «${check.clinicName ?? "sin nombre"}» (Smile Connect #${check.smileClinicId}). Profesionales: ${pros}. La conexión sigue apagada hasta que elijas un modo.${check.timezoneWarning ? ` Ojo: ${check.timezoneWarning}` : ""}`,
    };
  } catch (e) {
    return failed(e, "No se pudo guardar la clave.");
  }
}

export async function setSmileModeAction(_previous: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    const clinic = await getPanelClinic(form);
    const mode = text(form, "mode") as SmileMode | null;
    if (!mode || !SMILE_MODES.includes(mode)) return { ok: false, message: "Elegí un modo." };
    if ((mode === "crear" || mode === "completa") && form.get("confirm") !== "on") {
      return { ok: false, message: "Para escribir en Smile Connect, marcá que lo revisaste con el consultorio." };
    }
    await setSmileMode(clinic.id, mode);
    await logClinicChange(clinic.id, "Calendario");
    revalidatePath(PAGE);
    return { ok: true, message: `Modo: ${SMILE_MODE_LABEL[mode].label}.${WRITE_MODES.includes(mode) ? " Vale para los turnos que se den, muevan o cancelen desde ahora." : ""}` };
  } catch (e) {
    return failed(e, "No se pudo cambiar el modo.");
  }
}

export async function syncSmileNowAction(_previous: FormState, form: FormData): Promise<FormState> {
  try {
    const clinic = await getPanelClinic(form);
    const conn = await getSmileApiConnection(clinic.id);
    if (!conn?.api_key_encrypted || conn.api_mode === "apagada") return { ok: false, message: "La conexión está apagada." };
    // Cada sincronización gasta del cupo diario de la API: no más de una cada 5 minutos.
    if (conn.api_near_pull_at && Date.now() - new Date(conn.api_near_pull_at).getTime() < 5 * 60_000) {
      return { ok: false, message: "Se sincronizó hace menos de 5 minutos. Probá en un rato." };
    }
    try {
      const near = await pullSmileConnect(clinic.id, "cerca");
      const far = await pullSmileConnect(clinic.id, "lejos");
      revalidatePath(PAGE);
      const n = (k: keyof typeof near) => near[k] + far[k];
      return {
        ok: true,
        message: `Listo: ${n("leidos")} turnos leídos de Smile Connect (${n("appointmentsCreated")} nuevos, ${n("appointmentsUpdated")} con cambios, ${n("appointmentsCancelled")} cancelados).${n("pendientes") ? ` ${n("pendientes")} de pacientes nuevos entran en la próxima vuelta.` : ""}`,
      };
    } catch (e) {
      return { ok: false, message: await recordSmileError(clinic.id, e) };
    }
  } catch (e) {
    return failed(e, "No se pudo sincronizar.");
  }
}

export async function removeSmileApiKeyAction(form: FormData): Promise<void> {
  await requireAdmin();
  const clinic = await getPanelClinic(form);
  await removeSmileApiKey(clinic.id);
  await logClinicChange(clinic.id, "Calendario");
  revalidatePath(PAGE);
}

export async function resumeSmileWritesAction(form: FormData): Promise<void> {
  await requireAdmin();
  const clinic = await getPanelClinic(form);
  await resumeSmileWrites(clinic.id);
  revalidatePath(PAGE);
}

export async function dismissSmileReviewAction(form: FormData): Promise<void> {
  const clinic = await getPanelClinic(form);
  const id = text(form, "id");
  if (isUuid(id)) await dismissSmileReview(clinic.id, id);
  revalidatePath(PAGE);
}

/** Vincular a mano un profesional de Turnia con uno de Smile Connect (cuando el nombre no coincide). */
export async function linkSmileProfessionalAction(_previous: FormState, form: FormData): Promise<FormState> {
  await requireAdmin();
  try {
    const clinic = await getPanelClinic(form);
    const id = text(form, "professional_id");
    if (!isUuid(id)) return { ok: false, message: "No encontré ese profesional." };
    const raw = text(form, "smile_professional_id");
    const box = text(form, "smile_box_id");
    const smileId = raw && /^\d+$/.test(raw) ? Number(raw) : null;
    await linkSmileProfessional(clinic.id, id, smileId, box && /^\d+$/.test(box) ? Number(box) : null);
    await logClinicChange(clinic.id, "Calendario");
    revalidatePath(PAGE);
    return { ok: true, message: smileId ? "Vinculado." : "Desvinculado: Sofi no escribe sus turnos en Smile Connect." };
  } catch (e) {
    return failed(e, "No se pudo vincular.");
  }
}
