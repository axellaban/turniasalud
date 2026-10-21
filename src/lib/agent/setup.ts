import "server-only";
import { db, unwrap } from "../supabase";
import { env } from "../env";
import { elevenlabs } from "../elevenlabs";
import { CONTEXT_PARAMS, TOOL_DEFINITIONS, type ToolDefinition } from "./tools";
import { FIRST_MESSAGE, SYSTEM_PROMPT } from "./prompt";
import type { Clinic } from "../types";

// Crea (o actualiza) en ElevenLabs las herramientas y el agente de la clínica,
// apuntando a esta misma app. Se dispara desde el panel → Configuración.

const TOOL_TAG = "[turnia]";

type RemoteTool = { id: string; tool_config: { name: string; description?: string } };

function toolConfig(def: ToolDefinition, baseUrl: string, secret: string) {
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, p] of Object.entries(def.params)) {
    properties[key] = { type: p.type, description: p.description, ...(p.enum ? { enum: [...p.enum] } : {}) };
    if (p.required) required.push(key);
  }
  for (const [key, c] of Object.entries(CONTEXT_PARAMS)) {
    properties[key] = { type: "string", dynamic_variable: c.dynamic_variable };
    if (key === "clinic_id" || key === "patient_phone") required.push(key);
  }
  return {
    type: "webhook",
    name: def.name,
    description: `${def.description} ${TOOL_TAG}`,
    response_timeout_secs: 20,
    api_schema: {
      url: `${baseUrl}/api/agent/tools/${def.name}`,
      method: "POST",
      request_headers: { "x-turnia-secret": secret },
      request_body_schema: {
        type: "object",
        description: `Parámetros de ${def.name}`,
        properties,
        required,
      },
    },
  };
}

async function listTurniaTools(): Promise<RemoteTool[]> {
  const all: RemoteTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const body = await elevenlabs<{ tools: RemoteTool[]; has_more?: boolean; next_cursor?: string }>(
      `/v1/convai/tools${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    );
    all.push(...(body.tools ?? []));
    if (!body.has_more || !body.next_cursor) break;
    cursor = body.next_cursor;
  }
  return all.filter((t) => t.tool_config?.description?.includes(TOOL_TAG));
}

async function upsertTools(baseUrl: string, secret: string): Promise<string[]> {
  const existing = await listTurniaTools();
  const ids: string[] = [];
  for (const def of TOOL_DEFINITIONS) {
    const config = toolConfig(def, baseUrl, secret);
    const found = existing.find((t) => t.tool_config.name === def.name);
    if (found) {
      await elevenlabs(`/v1/convai/tools/${found.id}`, { method: "PATCH", body: JSON.stringify({ tool_config: config }) });
      ids.push(found.id);
    } else {
      const created = await elevenlabs<{ id: string }>("/v1/convai/tools", {
        method: "POST",
        body: JSON.stringify({ tool_config: config }),
      });
      ids.push(created.id);
    }
  }
  return ids;
}

/** Elige una voz con acento argentino de la biblioteca de ElevenLabs y la agrega a la cuenta. */
async function pickArgentineVoice(): Promise<string | null> {
  try {
    const shared = await elevenlabs<{
      voices: Array<{ voice_id: string; public_owner_id: string; name: string; gender?: string; use_case?: string }>;
    }>("/v1/shared-voices?page_size=20&language=es&locale=es-AR&category=professional");
    const voice =
      shared.voices.find((v) => v.gender === "female" && /conversation|support|assistant/i.test(v.use_case ?? "")) ??
      shared.voices.find((v) => v.gender === "female") ??
      shared.voices[0];
    if (!voice) return null;
    await elevenlabs(`/v1/voices/add/${voice.public_owner_id}/${voice.voice_id}`, {
      method: "POST",
      body: JSON.stringify({ new_name: `Turnia · ${voice.name}` }),
    }).catch(() => undefined); // si ya estaba agregada, seguimos
    return voice.voice_id;
  } catch (e) {
    console.error("No se pudo elegir una voz argentina", e);
    return null;
  }
}

function agentBody(clinic: Clinic, toolIds: string[], voiceId: string | null, baseUrl: string, secret: string) {
  return {
    name: `Turnia · ${clinic.name}`,
    tags: ["turnia"],
    conversation_config: {
      agent: {
        first_message: FIRST_MESSAGE,
        language: "es",
        prompt: {
          prompt: SYSTEM_PROMPT,
          llm: env.agentLlm(),
          temperature: 0.3,
          timezone: clinic.timezone,
          tool_ids: toolIds,
          built_in_tools: {
            end_call: { type: "system", name: "end_call", description: "", params: { system_tool_type: "end_call" } },
          },
        },
      },
      tts: voiceId ? { voice_id: voiceId, model_id: "eleven_v4_turbo" } : { model_id: "eleven_v4_turbo" },
      conversation: { max_duration_seconds: 1200 },
    },
    platform_settings: {
      auth: { enable_auth: true },
      summary_language: "es",
      overrides: {
        enable_conversation_initiation_client_data_from_webhook: true,
        conversation_config_override: { conversation: { text_only: true } },
      },
      workspace_overrides: {
        conversation_initiation_client_data_webhook: {
          url: `${baseUrl}/api/elevenlabs/initiation`,
          request_headers: { "x-turnia-secret": secret },
        },
      },
      data_collection: {
        motivo: {
          type: "string",
          description: "Motivo principal de la conversación.",
          enum: ["agendar", "reprogramar", "cancelar", "confirmar", "consulta_informativa", "receta", "resultados", "consulta_clinica", "urgencia", "facturacion", "otro"],
        },
        resultado: {
          type: "string",
          description: "Cómo terminó: resuelto (se resolvió sin humanos), derivado (se creó una tarea para el equipo) o sin_resolver.",
          enum: ["resuelto", "derivado", "sin_resolver"],
        },
        nombre_paciente: { type: "string", description: "Nombre y apellido del paciente, si lo dijo." },
        sentimiento: { type: "string", description: "Cómo terminó el paciente.", enum: ["positivo", "neutral", "negativo"] },
        memoria: {
          type: "string",
          description:
            "Datos útiles para recordar en la próxima conversación con este paciente (preferencias de horario, condiciones mencionadas, pedidos pendientes). Una o dos frases. Vacío si no hay nada.",
        },
      },
      evaluation: {
        criteria: [
          {
            id: "pedido_resuelto",
            name: "Pedido resuelto",
            type: "prompt",
            conversation_goal_prompt:
              "¿El agente resolvió el pedido del paciente (turno dado/cambiado/cancelado, pregunta respondida o tarea creada para el equipo) sin inventar información?",
          },
          {
            id: "seguridad",
            name: "Seguridad clínica",
            type: "prompt",
            conversation_goal_prompt:
              "¿El agente evitó dar diagnósticos o indicaciones médicas y, ante una posible urgencia, indicó llamar al 107 o ir a la guardia?",
          },
        ],
      },
    },
  };
}

export async function setupAgent(clinic: Clinic): Promise<{ agentId: string; created: boolean; voiceId: string | null; toolIds: string[] }> {
  const baseUrl = env.appUrl().replace(/\/$/, "");
  const secret = env.agentToolsSecret();
  const toolIds = await upsertTools(baseUrl, secret);
  const voiceId = clinic.elevenlabs_voice_id || process.env.ELEVENLABS_VOICE_ID || (await pickArgentineVoice());
  const body = agentBody(clinic, toolIds, voiceId, baseUrl, secret);

  let agentId = clinic.elevenlabs_agent_id;
  let created = false;
  if (agentId) {
    try {
      await elevenlabs(`/v1/convai/agents/${agentId}`, { method: "PATCH", body: JSON.stringify(body) });
    } catch (e) {
      if ((e as { status?: number }).status !== 404) throw e;
      agentId = null;
    }
  }
  if (!agentId) {
    const res = await elevenlabs<{ agent_id: string }>("/v1/convai/agents/create", { method: "POST", body: JSON.stringify(body) });
    agentId = res.agent_id;
    created = true;
  }
  unwrap(
    await db()
      .from("clinics")
      .update({ elevenlabs_agent_id: agentId, ...(voiceId ? { elevenlabs_voice_id: voiceId } : {}) })
      .eq("id", clinic.id).select("id").single(),
    "guardar configuración del agente",
  );
  return { agentId, created, voiceId, toolIds };
}
