// REGLAS DE COSTO DEL LABORATORIO DE SOFI (decisión de Axel, 28/11/2026). No se cambian sin una decisión
// escrita de Axel en PENDIENTES.md.
//
//   1. Simular (Sofi y el paciente simulado): la ÚNICA excepción a «nada de API». Simulador propio contra la
//      API de Claude, SOLO con Haiku (unos USD 0,005 por charla), con tope de USD 1 por corrida y USD 2 por
//      día, que cortan a mitad de corrida. El paciente va con Sofi porque la charla va y viene en cada turno.
//   2. Evaluar (el jurado), revisar charlas reales y proponer mejoras: NUNCA la API. Lo hace la suscripción
//      de Claude o ChatGPT desde Panel → Laboratorio → Evaluar (copiar el pedido, pegar la respuesta).
//      Nada de Opus.
//   3. ElevenLabs: NUNCA para pruebas (cuesta unas 12 veces más por charla que el simulador).
//   4. Nada automático: ni batería nocturna, ni verificación semanal, ni experimentos solos. Las corridas se
//      lanzan a mano desde el panel, antes de publicar un cambio en Sofi.
//
// Lo vigila src/test/laboratorio-sin-api.integration.test.ts.

export const LAB_API_RULE =
  "Regla del laboratorio: la API de Claude se usa solo para simular, con Haiku y con topes. Evaluar, revisar charlas reales y proponer mejoras lo hace Claude o ChatGPT con la suscripción (Panel → Laboratorio → Evaluar). ElevenLabs nunca se usa para pruebas, y no corre nada automático.";

/** Lo que ve el equipo en el panel cuando algo lo hace la suscripción y no el servidor. */
export const LAB_SUBSCRIPTION_MESSAGE =
  "Esto no lo hace el servidor: por regla, el laboratorio no usa la API para evaluar ni proponer. Se hace con tu Claude o tu ChatGPT desde la pestaña Evaluar (copiar el pedido, pegar la respuesta).";

export const LAB_ELEVENLABS_MESSAGE = "Por regla, las pruebas de Sofi no usan ElevenLabs: corren en el simulador (Haiku), con tope de gasto.";

/** Pausa total. Hoy false: el laboratorio anda con las reglas de arriba (se lanza a mano). */
export const LAB_PAUSED_MESSAGE =
  "El Laboratorio de Sofi está en pausa por decisión de Axel: no corre ninguna simulación hasta que él lo levante.";
export const labPaused = (): boolean => false;

/** Evaluar, proponer, armar casos o revisar con la API: siempre false. */
export const labApiAllowed = (): boolean => false;

/** Simular con la API (la única excepción): true, solo con Haiku y con topes. */
export const labSimulatorAllowed = (): boolean => true;

/** Simular en ElevenLabs: siempre false. */
export const labElevenLabsAllowed = (): boolean => false;

/** Corridas automáticas (batería nocturna, verificación, experimentos solos): siempre false. */
export const labAutoRunsAllowed = (): boolean => false;

/** El modelo del simulador: Haiku siempre, aunque una variable pida otro. */
export function labSimModel(): string {
  const wanted = process.env.LAB_SIM_LLM || process.env.LAB_LLM;
  return wanted && /haiku/i.test(wanted) ? wanted : "claude-haiku-5-5";
}

export class LabApiForbidden extends Error {
  constructor(where: string) {
    super(`${LAB_API_RULE} (bloqueado en: ${where})`);
    this.name = "LabApiForbidden";
  }
}

/** Corta antes de crear un cliente de la API. */
export function forbidLabApi(where: string): never {
  throw new LabApiForbidden(where);
}
