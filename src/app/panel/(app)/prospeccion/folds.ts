// Qué secciones de «Para hoy» dejó plegadas el administrador. Lo lee la página (servidor) y lo escribe
// la sección al tocar el título (navegador), así que no puede vivir en el módulo "use client".

/** Cookie con las secciones plegadas o desplegadas: «esperan:0,seguimientos:1». */
export const FOLD_COOKIE = "prospeccion_secciones";

/** «esperan:0,seguimientos:1» → { esperan: false, seguimientos: true } (true = abierta). */
export function parseFolds(raw: string | undefined): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const part of (raw ?? "").split(",")) {
    const [key, value] = part.split(":");
    if (key && (value === "0" || value === "1")) out[key] = value === "1";
  }
  return out;
}

export function serializeFolds(folds: Record<string, boolean>): string {
  return Object.entries(folds)
    .map(([k, v]) => `${k}:${v ? 1 : 0}`)
    .join(",");
}
