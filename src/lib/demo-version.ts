// Las versiones de la demo personal (/p/<código>), para comparar cómo convierte cada una.
//
// - «con_probar» (A), hasta el 07/11/2026: una página con «Probar la demo» y, al tocarlo, la pantalla de
//   la demo, donde se elegía voz o chat y empezaba la charla. Pasos: visitó → tocó «Probar la demo» →
//   empezó la charla → habló con Sofi.
// - «esfera» (B), desde el 07/11/2026 (turniasalud#138): una sola pantalla; tocar la esfera (o mandar el
//   primer mensaje) arma la demo y empieza la charla en el mismo gesto. Pasos: visitó → tocó la esfera →
//   habló con Sofi.
//
// El paso que se sacó es el del medio, así que «empezó la demo» (demo_at, `demo_started`) no significa lo
// mismo en las dos: en A era tocar un botón y todavía faltaba la charla; en B ya es la charla. Lo que se
// compara entre versiones es de punta a punta: **visitó → habló con Sofi** (escribió o habló; Sofi
// saluda primero, así que abrir la llamada y no decir nada no cuenta).
//
// El corte es el deploy de #138: se mergeó el 07/11 a las 12:26 (Argentina) y la primera visita con la
// pantalla nueva fue a las 12:32. Cada persona va a la versión de la visita (en PostHog, cada visita;
// en la base, la primera apertura, que es la única que queda con fecha).

export type DemoVersion = "con_probar" | "esfera";

export const ESFERA_DESDE = "2026-11-07T15:30:00.000Z";
export const DEMO_VERSION_ACTUAL: DemoVersion = "esfera";

export const DEMO_VERSIONS: Record<DemoVersion, { label: string; corta: string; pasos: string }> = {
  con_probar: { label: "A · Con «Probar la demo» (hasta el 07/11)", corta: "A · Con «Probar»", pasos: "Visitó → tocó «Probar la demo» → habló con Sofi" },
  esfera: { label: "B · Pantalla única con la esfera (desde el 07/11)", corta: "B · Esfera", pasos: "Visitó → tocó la esfera → habló con Sofi" },
};

/** La versión que vio quien la abrió en ese momento. */
export function demoVersionAt(at: string | Date | null | undefined): DemoVersion | null {
  if (!at) return null;
  const t = typeof at === "string" ? Date.parse(at) : at.getTime();
  if (Number.isNaN(t)) return null;
  return t < Date.parse(ESFERA_DESDE) ? "con_probar" : "esfera";
}

/** La misma regla en HogQL (PostHog), para los eventos de antes de que llevaran `demo_version`. */
export const DEMO_VERSION_HOGQL = `coalesce(properties.demo_version, if(timestamp < toDateTime('${ESFERA_DESDE.slice(0, 19).replace("T", " ")}'), 'con_probar', 'esfera'))`;
