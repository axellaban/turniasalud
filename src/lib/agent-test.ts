import "server-only";
import QRCode from "qrcode";
import { whatsappClinic } from "./channel";
import { demoWhatsappNumber } from "./demo/config";
import { messagingSettings } from "./messaging-settings";
import { displayPhone } from "./phone";
import type { Clinic } from "./types";
import { wahaConnectionForClinic } from "./waha-connections";

// Panel → Probar a Sofi: por dónde puede probar el consultorio a su agente, además del navegador.
// WhatsApp: su línea propia (o la general, si es la clínica que atiende), como un paciente más.
// Si no, un enlace reutilizable por la línea general que abre la prueba con esta ficha.

export type ChannelOption =
  /** Se le escribe directo a este número, como cualquier paciente. */
  | { kind: "numero"; number: string; display: string; url: string }
  /** Hay que preparar un enlace que abre la prueba con esta ficha. */
  | { kind: "enlace"; via: string }
  | { kind: "no"; reason: string };


/** «¡Hola!» ya escrito: el doctor solo toca enviar. */
export const waLink = (number: string, text = "¡Hola! Quiero sacar un turno.") => `https://wa.me/${number}?text=${encodeURIComponent(text)}`;

export async function testWhatsappFor(clinic: Pick<Clinic, "id">): Promise<ChannelOption> {
  const settings = await messagingSettings();
  let own;
  try {
    own = wahaConnectionForClinic(clinic.id);
  } catch (e) {
    // Una variable de líneas mal cargada no tiene que tirar la página: se ve que WhatsApp no está.
    console.error("Probar a Sofi: no se pudieron leer las líneas de WhatsApp", e instanceof Error ? e.message : e);
    return { kind: "no", reason: "El WhatsApp no está disponible en este momento." };
  }
  if (own) {
    return own.enabled
      ? { kind: "numero", number: own.phone, display: displayPhone(own.phone), url: waLink(own.phone) }
      : { kind: "no", reason: "El WhatsApp del consultorio está pausado." };
  }
  if (settings.active_channel !== "whatsapp") return { kind: "no", reason: "El WhatsApp de prueba no está activo en este momento." };
  const general = (await demoWhatsappNumber()).number;
  if (!general) return { kind: "no", reason: "El WhatsApp no está disponible en este momento." };
  // La línea general atiende a una sola clínica; las demás la prueban con un enlace de su ficha.
  const served = (await whatsappClinic()).id === clinic.id;
  return served
    ? { kind: "numero", number: general, display: displayPhone(general), url: waLink(general) }
    : { kind: "enlace", via: displayPhone(general) };
}

/** QR en SVG para abrir el enlace con la cámara del celular. */
export function qrSvg(url: string): Promise<string> {
  return QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#171729", light: "#ffffff" } });
}
