import { TAMANO, imagenPortada } from "@/lib/og";

export const alt = "Turnia Salud: agentes de IA que atienden el WhatsApp y el teléfono de tu clínica las 24 horas";
export const size = TAMANO;
export const contentType = "image/png";

export default function Image() {
  return imagenPortada();
}
