// Guiones de las demos de audio (escucha-a-nuestros-agentes, home y especialidades).
// Los textos viven en conversaciones.json para que scripts/generar-audios.mjs los lea
// con Node sin compilar TypeScript. Este archivo les da tipos y la duración estimada.
import datos from "./conversaciones.json";

export type LineaGuion = { quien: "agente" | "paciente"; texto: string };

export type Conversacion = {
  slug: string;
  titulo: string;
  descripcion: string;
  /** Slug de /especialidades/[slug] al que pertenece (no aplica a la home). */
  especialidad?: string;
  color: "brand" | "lila" | "sun" | "cielo";
  /** bebe, estetoscopio, embarazo, piel, estomago, corazon, telefono */
  icono: string;
  /** "03:40": estimada por cantidad de palabras hasta que exista el audio real. */
  duracionEstimada: string;
  lineas: LineaGuion[];
};

type ConversacionJson = Omit<Conversacion, "duracionEstimada">;

// Ritmo de una charla telefónica en rioplatense más la pausa entre turnos.
const PALABRAS_POR_MINUTO = 155;
const PAUSA_ENTRE_TURNOS = 0.4;

export function estimarSegundos(lineas: LineaGuion[]): number {
  const palabras = lineas.reduce((total, l) => total + l.texto.split(/\s+/).filter(Boolean).length, 0);
  return Math.round((palabras / PALABRAS_POR_MINUTO) * 60 + lineas.length * PAUSA_ENTRE_TURNOS);
}

export function formatearTiempo(segundos: number): string {
  const s = Math.max(0, Math.floor(segundos));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export const CONVERSACIONES: Conversacion[] = (datos as ConversacionJson[]).map((c) => ({
  ...c,
  duracionEstimada: formatearTiempo(estimarSegundos(c.lineas)),
}));

export function getConversacion(slug: string): Conversacion | undefined {
  return CONVERSACIONES.find((c) => c.slug === slug);
}
