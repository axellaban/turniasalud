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
  supabaseUrl: () => required("SUPABASE_URL"),
  supabaseServiceRoleKey: () => required("SUPABASE_SERVICE_ROLE_KEY"),
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

export function isConfigured(): { database: boolean; supabase: boolean; neon: boolean; elevenlabs: boolean; panel: boolean; tools: boolean } {
  const supabase = Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY);
  const neon = Boolean(process.env.NEON_DATA_API_URL && process.env.NEON_SERVER_PRIVATE_KEY);
  return {
    database: neon || supabase,
    supabase,
    neon,
    elevenlabs: Boolean(process.env.ELEVENLABS_API_KEY),
    panel: Boolean(process.env.PANEL_PASSWORD),
    tools: Boolean(process.env.AGENT_TOOLS_SECRET),
  };
}
