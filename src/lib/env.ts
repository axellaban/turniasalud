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
};

export function isConfigured(): { database: boolean; elevenlabs: boolean; panel: boolean; tools: boolean; webhook: boolean; n8n: boolean } {
  return {
    database: Boolean(process.env.DATABASE_URL || process.env.POSTGRES_URL),
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    panel: Boolean(process.env.PANEL_PASSWORD),
    tools: Boolean(process.env.AGENT_TOOLS_SECRET),
    webhook: Boolean(process.env.ELEVENLABS_WEBHOOK_SECRET),
    n8n: Boolean(process.env.N8N_WEBHOOK_URL),
  };
}
