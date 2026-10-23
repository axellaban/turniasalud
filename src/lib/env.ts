// Acceso centralizado a variables de entorno. Las obligatorias fallan con un
// mensaje claro en lugar de un "undefined" perdido en algún fetch.

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Falta la variable de entorno ${name}. Revisá la configuración en Vercel.`);
  }
  return value;
}

export const env = {
  elevenLabsApiKey: () => required("ELEVENLABS_API_KEY"),
  elevenLabsWebhookSecret: () => process.env.ELEVENLABS_WEBHOOK_SECRET ?? "",
  agentToolsSecret: () => required("AGENT_TOOLS_SECRET"),
  panelPassword: () => required("PANEL_PASSWORD"),
  sessionSecret: () => process.env.SESSION_SECRET || required("AGENT_TOOLS_SECRET"),
  defaultClinicId: () => process.env.DEFAULT_CLINIC_ID ?? "00000000-0000-4000-8000-000000000001",
  appUrl: () =>
    process.env.APP_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000"),
  agentLlm: () => process.env.AGENT_LLM || "claude-sonnet-5-5",
  n8nWebhookUrl: () => process.env.N8N_WEBHOOK_URL ?? "",
  telegramBotToken: () => required("TELEGRAM_BOT_TOKEN"),
  // WhatsApp por WAHA + Custom Channel de ElevenLabs
  wahaUrl: () => required("WAHA_URL").replace(/\/$/, ""),
  wahaApiKey: () => required("WAHA_API_KEY"),
  wahaSession: () => process.env.WAHA_SESSION || "default",
  wahaWebhookHmac: () => process.env.WAHA_WEBHOOK_HMAC ?? "",
  /** Pausa base entre mensajes de una campaña por WAHA (se le suma un azar), para bajar el riesgo de bloqueo. */
  wahaSendDelayMs: () => Number(process.env.WAHA_SEND_DELAY_MS ?? 2000) || 0,
  channelUrl: () => required("ELEVENLABS_CHANNEL_URL"),
  channelSecret: () => required("ELEVENLABS_CHANNEL_SECRET"),
  channelSigningSecret: () => process.env.ELEVENLABS_CHANNEL_SIGNING_SECRET ?? "",
  sttModel: () => process.env.ELEVENLABS_STT_MODEL || "scribe_v2",
};

/** Variables obligatorias para WhatsApp por WAHA (WAHA_SESSION es opcional: por defecto "default"). */
export const WAHA_ENV_VARS = [
  "WAHA_URL",
  "WAHA_API_KEY",
  "WAHA_WEBHOOK_HMAC",
  "ELEVENLABS_CHANNEL_URL",
  "ELEVENLABS_CHANNEL_SECRET",
  "ELEVENLABS_CHANNEL_SIGNING_SECRET",
] as const;

/** Solo los nombres de las que faltan, nunca los valores. */
export function missingWahaEnv(): string[] {
  return WAHA_ENV_VARS.filter((name) => !process.env[name]);
}

export function isConfigured(): {
  database: boolean;
  elevenlabs: boolean;
  panel: boolean;
  tools: boolean;
  webhook: boolean;
  n8n: boolean;
  waha: boolean;
} {
  return {
    database: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    panel: Boolean(process.env.PANEL_PASSWORD),
    tools: Boolean(process.env.AGENT_TOOLS_SECRET),
    webhook: Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET),
    n8n: Boolean(process.env.N8N_WEBHOOK_URL),
    waha: missingWahaEnv().length === 0,
  };
}
