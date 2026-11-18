import "server-only";
import { sql } from "./db";
import { muteNumber } from "./chat-guard";
import { staffForPhone } from "./staff";
import { isTurniaSend, type OwnMessage } from "./waha-sent";

export type { OwnMessage };

// Pausa automática de Sofi cuando el equipo le contesta a un paciente desde el WhatsApp del consultorio.
//
// WAHA avisa también los mensajes propios (evento `message.any`, con fromMe) si se suscribe a él. Son
// propios tanto lo que manda Turnia por la API como lo que escribe el equipo desde el celular, así que
// Turnia anota lo que manda (antes de mandarlo, para no perder la carrera con el webhook) y todo lo
// demás es del equipo. Se ignoran los automáticos de WhatsApp Business (bienvenida, ausencia), que
// salen apenas escribe el paciente. Apagado por defecto: cada clínica lo prende en Configuración.

/** Lo que pausa un mensaje del equipo desde el celular. */
export const AUTO_PAUSE_HOURS = 4;
/** Un mensaje propio que sale hasta estos segundos después del del paciente es un automático de WhatsApp Business. */
export const AUTOMATIC_REPLY_SECONDS = 15;

export type OwnMessageResult = "apagado" | "de-turnia" | "equipo" | "automatico" | "propia-linea" | "pausado";

/**
 * Un mensaje propio llegó por el webhook de una línea de clínica. Si lo escribió el equipo desde el
 * celular, Sofi deja de contestarle a ese paciente por unas horas (se reactiva desde el panel o pidiéndoselo).
 */
export async function handleOwnMessage(
  clinic: { id: string; auto_pause_on_staff_reply: boolean | null },
  msg: OwnMessage,
  phone: string,
  { linePhone, wait = (ms: number) => new Promise((r) => setTimeout(r, ms)) }: { linePhone?: string | null; wait?: (ms: number) => Promise<unknown> } = {},
): Promise<OwnMessageResult> {
  if (!clinic.auto_pause_on_staff_reply) return "apagado";
  if (msg.source === "api") return "de-turnia";
  if (linePhone && phone === linePhone) return "propia-linea";
  if (await isTurniaSend(msg)) return "de-turnia";
  // El aviso del webhook puede llegar antes de que Turnia termine de anotar el envío (o el mensaje del paciente).
  await wait(3000);
  if (await isTurniaSend(msg)) return "de-turnia";
  // Entre el equipo (el resumen, los avisos) no se pausa nada.
  if (await staffForPhone(clinic.id, phone)) return "equipo";
  const [justWrote] = await sql`
    select 1 from chat_usage where clinic_id = ${clinic.id} and phone = ${phone} and kind = 'mensaje'
      and created_at > now() - make_interval(secs => ${AUTOMATIC_REPLY_SECONDS}) limit 1`;
  if (justWrote) return "automatico";
  await muteNumber(clinic.id, phone, "equipo", "Le contestó el equipo desde el WhatsApp del consultorio.", AUTO_PAUSE_HOURS);
  return "pausado";
}
