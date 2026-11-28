// REGLA DEL LABORATORIO (Axel, 28/11/2026). ESTRICTAMENTE PROHIBIDO, sin excepciones:
//
//   El Laboratorio de Sofi y cualquier prueba o simulación de Sofi NUNCA usan la API de Anthropic ni la de
//   OpenAI con clave propia (ANTHROPIC_API_KEY, OPENAI_API_KEY ni otra). Ni el simulador, ni el juez, ni la
//   segunda instancia, ni las propuestas, ni el armado de casos.
//
// Por qué: las pruebas salieron caras con la API y son simulaciones. Se pagan dos cosas y nada más:
//   1. ElevenLabs: las simulaciones corren en sus pruebas de agentes (agent-testing).
//   2. La suscripción de Claude o de ChatGPT: evalúa las charlas, revisa las reales y propone mejoras.
//      Sin claves: en Panel → Laboratorio → Evaluar se copia el pedido, se pega en claude.ai o chatgpt.com y
//      se pega la respuesta. (También existe /api/lab/evaluaciones con el skill `laboratorio-sofi`, para
//      quien quiera automatizarlo con una clave; no hace falta.)
//
// Este archivo es el candado: `labApiAllowed` es false fijo y `forbidLabApi` corta antes de crear un cliente
// de la API. `src/test/laboratorio-sin-api.integration.test.ts` falla si alguien lo afloja. No lo cambies sin
// una decisión escrita de Axel en PENDIENTES.md.

export const LAB_API_RULE =
  "Regla del laboratorio: prohibido usar la API de Anthropic u OpenAI con clave para las pruebas de Sofi. Las simulaciones corren en ElevenLabs; evaluar, revisar charlas reales y proponer mejoras lo hace Claude o ChatGPT con la suscripción (Panel → Laboratorio → Evaluar).";

/** Lo que ve el equipo en el panel cuando algo lo hace la suscripción y no el servidor. */
export const LAB_SUBSCRIPTION_MESSAGE =
  "Esto no lo hace el servidor: por regla, el laboratorio no usa la API. Se hace con tu Claude o tu ChatGPT desde la pestaña Evaluar (copiar el pedido, pegar la respuesta).";

/** Siempre false: el laboratorio no puede llamar a la API de un modelo. */
export const labApiAllowed = (): boolean => false;

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
