// Lógica pura del reproductor de demos: qué línea del guion suena en cada momento.
// El JSON lo genera scripts/generar-audios.mjs junto al MP3 (public/audios/<slug>.json).

export type Segmento = { linea: number; inicio: number; fin: number };
export type Sincronizacion = { duracion: number; segmentos: Segmento[] };

/** Valida el JSON descargado; devuelve null si no tiene la forma esperada. */
export function leerSincronizacion(datos: unknown, totalLineas: number): Sincronizacion | null {
  if (!datos || typeof datos !== "object") return null;
  const { duracion, segmentos } = datos as { duracion?: unknown; segmentos?: unknown };
  if (typeof duracion !== "number" || !(duracion > 0) || !Array.isArray(segmentos)) return null;
  const validos: Segmento[] = [];
  for (const s of segmentos) {
    const { linea, inicio, fin } = (s ?? {}) as Record<string, unknown>;
    if (
      typeof linea === "number" &&
      Number.isInteger(linea) &&
      linea >= 0 &&
      linea < totalLineas &&
      typeof inicio === "number" &&
      typeof fin === "number" &&
      fin >= inicio
    ) {
      validos.push({ linea, inicio, fin });
    }
  }
  if (validos.length === 0) return null;
  validos.sort((a, b) => a.inicio - b.inicio);
  return { duracion, segmentos: validos };
}

/**
 * Línea del guion que corresponde al segundo `t`. En el silencio entre dos
 * segmentos sigue marcada la última que habló; antes de la primera, -1.
 * `segmentos` tiene que venir ordenado por inicio (leerSincronizacion lo ordena).
 */
export function lineaActiva(segmentos: Segmento[], t: number): number {
  let activa = -1;
  for (const s of segmentos) {
    if (s.inicio > t) break;
    activa = s.linea;
  }
  return activa;
}

/** Segundo en el que empieza una línea, para saltar a ella desde la transcripción. */
export function inicioDeLinea(segmentos: Segmento[], linea: number): number | null {
  const s = segmentos.find((x) => x.linea === linea);
  return s ? s.inicio : null;
}
