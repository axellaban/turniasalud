import "server-only";
import { sql } from "@/lib/db";
import { env } from "@/lib/env";
import { agentVoiceId, elevenlabs } from "@/lib/elevenlabs";

export const SALES_NAME = "Turnia · Sofi · ventas odontología";
const LEGACY_SALES_NAME = "Turnia · Agustín · ventas odontología";
export class SalesSetupError extends Error {}
export type SalesVoice = { voice_id: string; name: string; live_moderated: boolean; label: string };

/** Lee la voz REAL de la recepcionista principal. Nunca usa la clínica seleccionada en el navegador. */
export async function sofiSalesVoiceId(): Promise<string> {
  const [clinic] = await sql<{ elevenlabs_agent_id: string | null }[]>`select elevenlabs_agent_id from clinics where id = ${env.defaultClinicId()}`;
  if (!clinic?.elevenlabs_agent_id) throw new SalesSetupError("La clínica principal no tiene configurada la recepcionista Sofi.");
  const voiceId = await agentVoiceId(clinic.elevenlabs_agent_id);
  if (!voiceId) throw new SalesSetupError("No se pudo leer la voz de Sofi. No se cambió el agente clínico.");
  return voiceId;
}

/** Solo voces ya guardadas: nunca agrega clones ni voces con tarifas especiales. */
export async function listSalesVoices(): Promise<SalesVoice[]> {
  const voices: SalesVoice[] = [];
  let next: string | undefined;
  for (let pageNo = 0; pageNo < 20; pageNo++) {
    const page = await elevenlabs<{ voices: Array<{ voice_id: string; name: string; labels?: Record<string,string>; sharing?: { live_moderation_enabled?: boolean } | null }>; has_more?: boolean; next_page_token?: string }>(`/v2/voices?page_size=100${next ? `&next_page_token=${encodeURIComponent(next)}` : ""}`, { signal: AbortSignal.timeout(15000) });
    voices.push(...page.voices.map((v) => ({ voice_id: v.voice_id, name: v.name, live_moderated: v.sharing?.live_moderation_enabled === true,
      label: [v.labels?.gender,v.labels?.language,v.labels?.accent].filter(Boolean).join(" · ") })));
    next = page.has_more ? page.next_page_token : undefined;
    if (!next) return voices;
  }
  throw new SalesSetupError("No se pudo completar la lista de voces. No se cambió el agente.");
}
export { FIRST_MESSAGE, MAX_SECONDS, SALES_PROMPT } from "./config";
import { MAX_SECONDS, renderSalesPrompt, salesConfiguration, salesConfigurationSchema, type SalesConfiguration } from "./config";

type Tool = { id: string; tool_config: { name: string; description?: string } };
type RemoteAgent = {
  name?: string;
  conversation_config?: {
    conversation?: { max_duration_seconds?: number };
    tts?: { voice_id?: string };
    agent?: { first_message?: string; prompt?: { prompt?: string; tool_ids?: string[]; mcp_server_ids?: string[]; native_mcp_server_ids?: string[]; built_in_tools?: Record<string, unknown> } };
  };
  platform_settings?: { overrides?: { enable_conversation_initiation_client_data_from_webhook?: boolean } };
};

export function salesAgentBody(voiceId: string, toolIds: string[], config: SalesConfiguration = salesConfiguration()) {
  return {
    name: SALES_NAME,
    tags: ["turnia-sales"],
    conversation_config: {
      agent: {
        first_message: config.first_message, language: "es",
        max_conversation_duration_message: "Gracias por tu tiempo. Hasta luego.",
        prompt: {
          prompt: renderSalesPrompt(config), llm: "gpt-4.1-mini", temperature: 0.3, max_tokens: 180,
          timezone: "America/Argentina/Buenos_Aires", tool_ids: toolIds,
          enable_parallel_tool_calls: false,
          built_in_tools: { end_call: { type: "system", name: "end_call", params: { system_tool_type: "end_call" } } },
        },
      },
      tts: { voice_id: voiceId, model_id: "eleven_v4_turbo" },
      conversation: { max_duration_seconds: MAX_SECONDS },
      turn: { silence_end_call_timeout: 15 },
    },
    platform_settings: {
      // El esquema enumera modelos que el análisis todavía rechaza (422).
      // Heredar su modelo predeterminado, como los agentes clínicos existentes.
      auth: { enable_auth: true }, summary_language: "es",
      overrides: { enable_conversation_initiation_client_data_from_webhook: false },
      call_limits: { agent_concurrency_limit: 1, daily_limit: 20, bursting_enabled: false },
      queueing_config: { enabled: false },
      privacy: { record_voice: false, retention_days: 30, apply_to_existing_conversations: false },
    },
  };
}

function toolConfig(name: string, description: string, properties: Record<string, unknown>, required: string[]) {
  return {
    type: "webhook", name, description: `${description} [turnia-sales]`,
    response_timeout_secs: 20, execution_mode: "immediate",
    interruption_mode: "disable_during_tool", pre_tool_speech: "off",
    api_schema: {
      url: `${env.appUrl().replace(/\/$/, "")}/api/comercial/tools/${name}`, method: "POST",
      request_headers: { "x-turnia-secret": env.agentToolsSecret() },
      request_body_schema: {
        type: "object", properties: {
          sales_call_id: { type: "string", dynamic_variable: "sales_call_id" },
          sales_call_token: { type: "string", dynamic_variable: "sales_call_token" }, ...properties,
        }, required: ["sales_call_id", "sales_call_token", ...required],
      },
    },
  };
}

/** Solo crea/actualiza el agente comercial. No usa el setup clínico ni asigna la línea entrante. */
export type SalesConfigChange = { config?: SalesConfiguration; expectedVersion: number; restorePrevious?: boolean };
export async function setupSalesAgent(selectedVoiceId?: string, change?: SalesConfigChange): Promise<void> {
  // La pausa persiste también si el proveedor rechaza una actualización parcial.
  await sql`update sales_settings set enabled = false where id = 1`;
  let attemptedVersion: number | undefined;
  let remoteWrite = false;
  try { await sql.begin(async (tx) => {
    const [settings] = await tx`select * from sales_settings where id = 1 for update`;
    if (change && settings.config_version !== change.expectedVersion) throw new SalesSetupError("Otra pestaña cambió la configuración. Recargá para ver la versión actual antes de guardar.");
    let config = salesConfiguration(settings);
    let source = change?.config ? "edicion" : "sincronizacion";
    if (change?.restorePrevious) {
      const [previous] = await tx`select * from sales_config_versions where version < ${settings.config_version} order by version desc limit 1`;
      if (!previous) throw new SalesSetupError("Todavía no hay una versión anterior para restaurar.");
      config = salesConfiguration(previous);
      selectedVoiceId = previous.voice_id;
      source = "restauracion";
    } else if (change?.config) config = salesConfigurationSchema.parse(change.config);
    if ((await tx`select id from sales_calls where status in ('iniciando','en_curso','incierta') limit 1`).length) throw new SalesSetupError("Revisá la llamada pendiente antes de configurar el agente.");
    await tx`update sales_settings set enabled = false where id = 1`;
    const voices = await listSalesVoices();
    const voice = voices.find((v) => v.voice_id === (selectedVoiceId || settings.voice_id));
    if (!voice) throw new SalesSetupError("Elegí una voz guardada en ElevenLabs.");
    if (voice.live_moderated) throw new SalesSetupError(`ElevenLabs no permite «${voice.name}» en agentes en vivo por su moderación. Elegí otra voz compatible; no se cambió ninguna voz existente.`);
    const voiceId = voice.voice_id;
    const remote: Tool[] = [];
    let cursor: string | undefined;
    do {
      const page = await elevenlabs<{ tools: Tool[]; has_more?: boolean; next_cursor?: string }>(`/v1/convai/tools?page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      remote.push(...page.tools);
      cursor = page.has_more ? page.next_cursor : undefined;
    } while (cursor);
    attemptedVersion = settings.config_version;
    const configs = [
      toolConfig("registrar_baja_comercial", "Guarda de inmediato la petición de no recibir más llamadas. Esperá ok antes de confirmar y luego colgá.", { reason: { type: "string", description: "Motivo de la baja sin datos sensibles" } }, ["reason"]),
      toolConfig("registrar_resultado_comercial", "Guarda el resultado para el seguimiento manual de Axel. No envía mensajes.", {
        outcome: { type: "string", enum: ["interesado", "seguimiento", "no_interesado", "numero_equivocado"], description: "Resultado confirmado por el interlocutor" },
        summary: { type: "string", description: "Resumen breve y próximo paso acordado, sin datos de pacientes" },
      }, ["outcome", "summary"]),
    ];
    const ids: string[] = [];
    for (const config of configs) {
      remoteWrite = true;
      const existing = remote.find((t) => t.tool_config.name === config.name && t.tool_config.description?.includes("[turnia-sales]"));
      if (existing) {
        await elevenlabs(`/v1/convai/tools/${encodeURIComponent(existing.id)}`, { method: "PATCH", body: JSON.stringify({ tool_config: config }) });
        ids.push(existing.id);
      } else {
        const created = await elevenlabs<{ id: string }>("/v1/convai/tools", { method: "POST", body: JSON.stringify({ tool_config: config }) });
        ids.push(created.id);
      }
    }
    const body = salesAgentBody(voiceId, ids, config);
    let agentId = settings.agent_id as string | null;
    if (!agentId) {
      // Si el POST anterior creó el agente pero se perdió la confirmación/commit,
      // recuperarlo por identidad antes de intentar crear otro.
      let cursor: string | undefined;
      do {
        const page = await elevenlabs<{ agents: Array<{ agent_id: string; name: string }>; has_more?: boolean; next_cursor?: string }>(`/v1/convai/agents?page_size=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
        const candidates = page.agents.filter((a) => a.name === SALES_NAME || a.name === LEGACY_SALES_NAME);
        if (candidates.length > 1) throw new Error("Hay más de un agente comercial de Turnia. Revisá los agentes antes de continuar.");
        agentId = candidates[0]?.agent_id ?? null;
        cursor = page.has_more ? page.next_cursor : undefined;
      } while (!agentId && cursor);
    }
    if (agentId) {
      const old = await elevenlabs<RemoteAgent>(`/v1/convai/agents/${encodeURIComponent(agentId)}`);
      if (![SALES_NAME, LEGACY_SALES_NAME].includes(old.name ?? "") || (await tx`select id from clinics where elevenlabs_agent_id = ${agentId} limit 1`).length) throw new Error("El agente guardado no es el comercial de Turnia. Se frenó la actualización.");
      await elevenlabs(`/v1/convai/agents/${encodeURIComponent(agentId)}`, { method: "PATCH", body: JSON.stringify(body) });
    } else {
      const created = await elevenlabs<{ agent_id: string }>("/v1/convai/agents/create", { method: "POST", body: JSON.stringify(body) });
      agentId = created.agent_id;
    }
    await verifySalesAgent(agentId, voiceId, ids, config);
    if (settings.voice_id) {
      const oldConfig = salesConfiguration(settings);
      await tx`insert into sales_config_versions (version,first_message,system_prompt,voice_id,source)
        values (${settings.config_version},${oldConfig.first_message},${oldConfig.system_prompt},${settings.voice_id},'anterior') on conflict do nothing`;
    }
    const version = settings.config_version + 1;
    await tx`insert into sales_config_versions (version,first_message,system_prompt,voice_id,source)
      values (${version},${config.first_message},${config.system_prompt},${voiceId},${source})`;
    await tx`update sales_settings set agent_id = ${agentId}, voice_id = ${voiceId}, tool_ids = ${ids},
      first_message = ${config.first_message}, system_prompt = ${config.system_prompt}, config_version = ${version},
      applied_at = now(), needs_sync = false, enabled = false, updated_at = now() where id = 1`;
  }); } catch (error) {
    // Un fallo después de escribir en el proveedor puede dejar una aplicación parcial.
    // No pisar el estado si otro guardado ya terminó con una versión posterior.
    if (remoteWrite && attemptedVersion !== undefined) await sql`update sales_settings set needs_sync = true, enabled = false where id = 1 and config_version = ${attemptedVersion}`;
    throw error;
  }
}

/** Revalida el límite real del proveedor y la separación de herramientas antes de cada llamada. */
export async function verifySalesAgent(agentId: string, voiceId: string, toolIds: string[], config: SalesConfiguration = salesConfiguration()) {
  const a = await elevenlabs<RemoteAgent>(`/v1/convai/agents/${encodeURIComponent(agentId)}`, { signal: AbortSignal.timeout(15000) });
  const c = a.conversation_config;
  const p = c?.agent?.prompt;
  if (a.name !== SALES_NAME || c?.conversation?.max_duration_seconds !== MAX_SECONDS || c?.tts?.voice_id !== voiceId ||
    c?.agent?.first_message !== config.first_message || p?.prompt !== renderSalesPrompt(config) ||
    [...(p.tool_ids ?? [])].sort().join() !== [...toolIds].sort().join() || toolIds.length !== 2 ||
    p.mcp_server_ids?.length || p.native_mcp_server_ids?.length ||
    !p.built_in_tools?.end_call || Object.entries(p.built_in_tools).some(([k, v]) => k !== "end_call" && v) ||
    a.platform_settings?.overrides?.enable_conversation_initiation_client_data_from_webhook !== false) {
    throw new Error("La configuración remota de la agente comercial cambió o no conserva los límites del piloto. Volvé a prepararla.");
  }
}
