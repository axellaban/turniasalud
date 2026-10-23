import { requireActiveChannel } from "./messaging-settings";
import "server-only";
import { buildDynamicVariables } from "./clinic";
import { sendWhatsAppTemplate } from "./elevenlabs";
import { env, missingWahaEnv } from "./env";
import { registerOutbound } from "./channel";
import { chatIdForPhone, wahaSendText } from "./waha";
import type { Clinic } from "./types";

// Un solo punto para escribirle a un paciente por WhatsApp, sea cual sea el
// proveedor de la clínica:
// - meta: template aprobado por Meta, enviado por ElevenLabs (oficial).
// - waha: el mismo texto como mensaje común desde el chip conectado a WAHA. Si
//   el paciente responde, lo atiende el agente por el Custom Channel con el
//   contexto de este mensaje.

export type TemplateKey = "recordatorio" | "recall" | "lista_espera" | "reactivacion" | "no_show" | "encuesta" | "respuesta" | "personalizada";

/** Textos de los templates ({{1}} = nombre, {{2}} = detalle). Son los mismos que hay que cargar en WhatsApp Manager. */
export const TEMPLATE_TEXTS: Record<TemplateKey, string> = {
  recordatorio: "¡Hola {{1}}! Te recordamos tu turno el {{2}}. ¿Nos confirmás si venís? Si no podés, respondé este mensaje y lo reprogramamos.",
  recall: "¡Hola {{1}}! Ya es momento de tu {{2}}. ¿Querés que te busquemos un turno?",
  lista_espera: "¡Hola {{1}}! Se liberó un turno el {{2}}. Si lo querés, respondé este mensaje y te lo reservamos.",
  no_show: "Hola {{1}}, te esperamos para tu {{2}} y no pudiste venir. ¿Querés que lo reprogramemos?",
  reactivacion: "¡Hola {{1}}! Hace un tiempo que no te vemos por {{2}}. ¿Querés sacar un turno para un control?",
  encuesta: "¡Hola {{1}}! Gracias por venir a {{2}}. Del 0 al 10, ¿qué tan probable es que nos recomiendes? Tu respuesta nos ayuda a mejorar.",
  respuesta: "Hola {{1}}, te escribimos por tu pedido: {{2}} Si necesitás algo más, respondé este mensaje.",
  personalizada: "¡Hola {{1}}! Te escribimos de {{2}} con un aviso. Respondé este mensaje y te contamos.",
};

/** Mensajes que no pidió el paciente: por WAHA llevan cómo darse de baja (baja el riesgo de bloqueo). */
const PROMOTIONAL: ReadonlySet<TemplateKey> = new Set(["recall", "reactivacion", "no_show", "encuesta", "personalizada"]);
export const OPT_OUT_FOOTER = "Si no querés recibir más mensajes, respondé BAJA.";

export function templateKeyFor(type: string): TemplateKey {
  return type in TEMPLATE_TEXTS ? (type as TemplateKey) : "personalizada";
}

export function renderTemplate(key: TemplateKey, params: string[], opts: { optOutFooter?: boolean } = {}): string {
  const text = TEMPLATE_TEXTS[key].replace(/\{\{(\d)\}\}/g, (_, n: string) => params[Number(n) - 1] ?? "");
  return opts.optOutFooter && PROMOTIONAL.has(key) ? `${text}\n\n${OPT_OUT_FOOTER}` : text;
}

/** Por qué no se puede escribir por WhatsApp todavía (null = listo). */
export function whatsappReadiness(clinic: Clinic): string | null {
  if (clinic.whatsapp_provider === "waha") {
    const missing = missingWahaEnv();
    return missing.length ? `Faltan variables de WAHA en Vercel: ${missing.join(", ")}.` : null;
  }
  if (!clinic.whatsapp_phone_number_id) return "Falta el ID del número de WhatsApp en Configuración.";
  if (!clinic.elevenlabs_agent_id) return "Primero creá el agente en Configuración.";
  if (!process.env.ELEVENLABS_API_KEY) return "Falta ELEVENLABS_API_KEY en Vercel.";
  return null;
}

export type PatientMessage = {
  phone: string;
  templateKey: TemplateKey;
  /** Nombre del template en WhatsApp Manager (solo Meta). */
  templateName: string;
  language?: string;
  params: [string, string];
  /** Qué tiene que saber el agente si el paciente responde. */
  context: string;
  campaignId?: string;
};

/** Le escribe al paciente. Devuelve el ID de conversación de ElevenLabs si ya existe (Meta). */
export async function sendPatientMessage(clinic: Clinic, msg: PatientMessage): Promise<{ conversation_id: string | null }> {
  if (clinic.is_demo) throw new Error("Modo demo: no se envían avisos ni campañas a pacientes.");
  await requireActiveChannel("whatsapp");
  const problem = whatsappReadiness(clinic);
  if (problem) throw new Error(problem);

  if (clinic.whatsapp_provider === "waha") {
    const text = renderTemplate(msg.templateKey, msg.params, { optOutFooter: true });
    const chatId = chatIdForPhone(msg.phone);
    await wahaSendText(chatId, text);
    await registerOutbound(clinic.id, { phone: msg.phone, chatId, text, context: msg.context, campaignId: msg.campaignId });
    return { conversation_id: null };
  }

  const res = await sendWhatsAppTemplate({
    phoneNumberId: clinic.whatsapp_phone_number_id!,
    userId: msg.phone,
    templateName: msg.templateName,
    language: msg.language || clinic.templates?.idioma || "es_AR",
    params: msg.params,
    agentId: clinic.elevenlabs_agent_id!,
    dynamicVariables: await buildDynamicVariables(clinic, msg.phone, { context: msg.context, campaignId: msg.campaignId }),
  });
  return { conversation_id: res.conversation_id ?? null };
}

/** Pausa entre envíos masivos por WAHA, con azar para no parecer un robot. */
export async function pauseBetweenSends(clinic: Clinic): Promise<void> {
  if (clinic.whatsapp_provider !== "waha") return;
  const base = env.wahaSendDelayMs();
  if (base <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, base * (0.5 + Math.random())));
}
