import "server-only";
import { sql } from "./db";
import { getClinic } from "./clinic";
import { notifyN8n } from "./n8n";
import { sendPatientMessage, whatsappReadiness } from "./whatsapp";
import type { Task } from "./types";

export type TaskResolution = { ok: boolean; message: string; notified: boolean };

// Meta no acepta saltos de línea ni textos largos en las variables de un template.
const MAX_RESPONSE = 900;

export function cleanResponse(raw: string | null | undefined): string | null {
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, MAX_RESPONSE) : null;
}

/**
 * Resuelve un pedido (receta, resultados, orden médica…). Si el equipo escribió
 * una respuesta, se guarda (el agente la ve si el paciente vuelve a escribir) y
 * se le manda al paciente por WhatsApp con el template "respuesta".
 */
export async function resolveTask(clinicId: string, taskId: string, rawResponse: string | null): Promise<TaskResolution> {
  const clinic = await getClinic(clinicId);
  const [task] = await sql<Array<Task & { phone: string | null; full_name: string | null }>>`
    select t.*, p.phone, p.full_name
    from tasks t left join patients p on p.id = t.patient_id
    where t.id = ${taskId} and t.clinic_id = ${clinic.id}`;
  if (!task) return { ok: false, message: "No encontré la tarea.", notified: false };

  const response = cleanResponse(rawResponse);
  await sql`
    update tasks set
      status = 'resuelta',
      resolved_at = now(),
      response = coalesce(${response}::text, response),
      responded_at = case when ${response}::text is null then responded_at else now() end
    where id = ${task.id}`;
  await notifyN8n("tarea.resuelta", { clinic_id: clinic.id, task: { ...task, status: "resuelta", response } });
  if (!response) return { ok: true, message: "Tarea resuelta.", notified: false };

  // Por WAHA no hace falta template de Meta: se manda el texto de "respuesta".
  const template = clinic.templates?.respuesta ?? (clinic.whatsapp_provider === "waha" ? "respuesta" : null);
  const phone = task.phone ?? "";
  if (!template || whatsappReadiness(clinic) || !/^\d{8,15}$/.test(phone)) {
    return {
      ok: true,
      message:
        "Tarea resuelta y respuesta guardada. No se avisó por WhatsApp (falta el template de respuesta, el número de WhatsApp o el celular del paciente); el agente igual la ve si el paciente escribe.",
      notified: false,
    };
  }
  try {
    const context = `Le escribimos para responder su pedido "${task.title}". Respuesta del equipo: ${response}. Si tiene dudas, ayudalo; si necesita algo más del equipo, creá una tarea.`;
    await sendPatientMessage(clinic, {
      phone,
      templateKey: "respuesta",
      templateName: template,
      params: [task.full_name?.split(" ")[0] || "hola", response],
      context,
    });
    return { ok: true, message: "Tarea resuelta y respuesta enviada por WhatsApp.", notified: true };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, message: `Tarea resuelta, pero no se pudo enviar el WhatsApp: ${message.slice(0, 200)}`, notified: false };
  }
}
