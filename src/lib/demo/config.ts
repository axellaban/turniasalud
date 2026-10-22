import "server-only";
import { sql } from "../db";
import { missingWahaEnv } from "../env";
import { wahaOwnNumber } from "../waha";

// Estado de la demo del lead magnet (/probar-demo): lo usan la landing, el
// panel y /api/health para saber qué falta, sin mostrar valores secretos.

/** Número de WhatsApp de la demo: DEMO_WHATSAPP_NUMBER o, si no está, el del chip conectado a WAHA. */
export async function demoWhatsappNumber(): Promise<{ number: string | null; source: "variable" | "waha" | null }> {
  const fromEnv = (process.env.DEMO_WHATSAPP_NUMBER ?? "").replace(/\D/g, "");
  if (fromEnv) return { number: fromEnv, source: "variable" };
  if (missingWahaEnv().length) return { number: null, source: null };
  const number = await wahaOwnNumber();
  return number ? { number, source: "waha" } : { number: null, source: null };
}

/** ¿La base ya tiene las tablas de la demo? (se crean solas en cada deploy de producción). */
export async function demoSchemaReady(): Promise<boolean> {
  try {
    const [row] = await sql<{ ok: boolean }[]>`select to_regclass('public.demo_sessions') is not null as ok`;
    return Boolean(row?.ok);
  } catch {
    return false;
  }
}

export type DemoStatusReport = {
  /** Tablas de la demo creadas en la base. */
  base: boolean;
  /** Hay número de WhatsApp para el botón PROBAR DEMO y WAHA para atenderlo. */
  whatsapp: boolean;
  whatsapp_source: "variable" | "waha" | null;
  /** Claude arma la ficha de la clínica (si no, perfil básico). */
  claude: boolean;
  /** La opción "Llamada" llama al celular (si no, manda un link para hablar desde el navegador). */
  llamada_telefonica: boolean;
};

export async function demoStatus(): Promise<DemoStatusReport> {
  const [base, wa] = await Promise.all([demoSchemaReady(), demoWhatsappNumber()]);
  return {
    base,
    whatsapp: Boolean(wa.number) && missingWahaEnv().length === 0,
    whatsapp_source: wa.source,
    claude: Boolean(process.env.ANTHROPIC_API_KEY),
    llamada_telefonica: Boolean(process.env.ELEVENLABS_PHONE_NUMBER_ID),
  };
}
