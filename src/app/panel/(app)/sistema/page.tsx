import Link from "next/link";
import { requireAdmin } from "@/lib/panel-clinic";
import { getClinic } from "@/lib/clinic";
import { WAHA_ENV_VARS, env, isConfigured, missingWahaEnv } from "@/lib/env";
import { demoStatus } from "@/lib/demo/config";
import { estadoAudios } from "@/lib/web-audios";
import { messagingSettings } from "@/lib/messaging-settings";
import { telegramConfigured } from "@/lib/telegram";
import { Badge, Card, CheckMark as Check, PageHeader } from "@/components/ui";
import { AgentSetupButton } from "./agent-setup";
import { AudiosWeb } from "./audios-web";
import { Canales } from "./canales";
import { DemoLimitForm } from "./demo-limit";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sistema · Panel" };

// Generar los audios de la web puede tardar ~1 minuto por conversación.
export const maxDuration = 300;

function CopyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-sm">
      <p className="font-medium text-brand-900">{label}</p>
      <code className="mt-1 block break-all rounded-lg bg-brand-50 px-3 py-2 text-xs text-brand-800">{value}</code>
    </div>
  );
}


/** Canal, agente, integraciones y audios: lo general de Turnia, solo para el administrador. */
export default async function SystemPage() {
  await requireAdmin();
  const [main, messaging, audios, demo] = await Promise.all([getClinic(), messagingSettings(), estadoAudios(), demoStatus()]);
  const configured = isConfigured();
  const missingWaha = new Set(missingWahaEnv());
  const base = env.appUrl().replace(/\/$/, "");
  const demoReady = demo.base && (demo.canal === "telegram" ? demo.telegram : demo.whatsapp);

  return (
    <>
      <PageHeader title="Sistema" description="Lo general de Turnia: canal de atención, agente, integraciones y audios de la web. Vale para todas las clínicas." />
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="space-y-6">
          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Canal de la demo y del agente</h2>
            <Canales settings={messaging} telegramConfigured={telegramConfigured()} whatsappConfigured={configured.waha} />
          </Card>

          <Card>
            <h2 className="font-semibold text-brand-950">Agente de IA</h2>
            <p className="mt-1 text-sm text-brand-900/60">Crea o actualiza el agente compartido en ElevenLabs, con sus herramientas apuntando a esta app. Usa la clínica principal ({main.name}).</p>
            <div className="mt-3 text-sm">
              {main.elevenlabs_agent_id ? <p><Badge tone="green">Conectado</Badge> <code className="text-xs">{main.elevenlabs_agent_id}</code></p> : <Badge tone="yellow">Sin crear</Badge>}
            </div>
            <div className="mt-4">
              <AgentSetupButton disabled={!configured.elevenlabs || !configured.tools} />
              {(!configured.elevenlabs || !configured.tools) && <p className="mt-2 text-xs text-red-600">Faltan ELEVENLABS_API_KEY y/o AGENT_TOOLS_SECRET en Vercel.</p>}
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold text-brand-950">Demo con tu web</h2>
            <p className="mb-3 text-xs text-brand-900/60">
              <Badge tone={demoReady ? "green" : "yellow"}>{demoReady ? "Activa" : "Falta configurar"}</Badge>{" "}
              El interesado deja su web en <Link href="/probar-demo" className="underline">/probar-demo</Link> y la prueba por el canal habilitado.
            </p>
            <ul className="space-y-1 text-sm">
              <li><Check ok={demo.base} />Base actualizada <span className="text-xs text-brand-900/50">(se actualiza sola en cada deploy de producción)</span></li>
              <li><Check ok={demo.whatsapp} />WhatsApp de la demo{" "}
                <span className="text-xs text-brand-900/50">{demo.whatsapp_source === "variable" ? "(DEMO_WHATSAPP_NUMBER)" : demo.whatsapp_source === "waha" ? "(número del chip de WAHA)" : "(necesita WAHA conectado)"}</span>
              </li>
              <li><Check ok={demo.claude} warn /><code className="text-xs">ANTHROPIC_API_KEY</code> <span className="text-xs text-brand-900/50">{demo.claude ? "" : "(sin clave arma una ficha básica)"}</span></li>
              <li><Check ok={demo.llamada_telefonica} optional /><code className="text-xs">ELEVENLABS_PHONE_NUMBER_ID</code> <span className="text-xs text-brand-900/50">{demo.llamada_telefonica ? "(llama al celular)" : "(opcional: sin número, la llamada es desde el navegador)"}</span></li>
            </ul>
            <div className="mt-4 border-t border-brand-900/10 pt-4"><DemoLimitForm limit={messaging.demo_daily_limit} /></div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Estado</h2>
            <ul className="space-y-1 text-sm">
              <li><Check ok={configured.database} />Base de datos (DATABASE_URL)</li>
              <li><Check ok={configured.elevenlabs} />ElevenLabs API key</li>
              <li><Check ok={configured.tools} />AGENT_TOOLS_SECRET</li>
              <li><Check ok={configured.webhook} />ELEVENLABS_WEBHOOK_SECRET</li>
              <li><Check ok={configured.n8n} optional />N8N_WEBHOOK_URL (opcional)</li>
              <li className="pt-2 text-xs text-brand-900/50">LLM del agente: {env.agentLlm()}</li>
            </ul>
          </Card>
        </div>

        <div className="space-y-6">
          <Card>
            <h2 className="mb-1 font-semibold text-brand-950">WhatsApp por WAHA</h2>
            <p className="mb-3 text-xs text-brand-900/60">
              {main.whatsapp_provider === "waha" ? (
                <Badge tone={messaging.active_channel === "whatsapp" ? "green" : "yellow"}>{messaging.active_channel === "whatsapp" ? "Habilitado" : "Pausado"}</Badge>
              ) : (
                "Proveedor general actual: Meta. Editar el contexto conserva esta conexión."
              )}
            </p>
            <ul className="space-y-1 text-sm">
              {WAHA_ENV_VARS.map((name) => (
                <li key={name}>
                  <Check ok={!missingWaha.has(name)} /><code className="text-xs">{name}</code>
                </li>
              ))}
              <li><Check ok={false} optional /><code className="text-xs">WAHA_SESSION</code> <span className="text-xs text-brand-900/50">(opcional: {env.wahaSession()})</span></li>
            </ul>
            <div className="mt-4 space-y-3">
              <CopyRow label="Webhook de la sesión en WAHA (evento “message”, con clave HMAC)" value={`${base}/api/waha/webhook`} />
              <CopyRow label="Reply Webhook URL del Custom Channel (ElevenLabs → agente → Channels)" value={`${base}/api/elevenlabs/canal`} />
              <p className="text-xs text-brand-900/50">Los valores se cargan en Vercel → Settings → Environment Variables. Acá nunca se muestran.</p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">URLs para ElevenLabs y n8n</h2>
            <div className="space-y-3">
              <CopyRow label="Webhook post-conversación (ElevenLabs → Agents → Settings)" value={`${base}/api/elevenlabs/post-call`} />
              <CopyRow label="Webhook de inicio (se configura solo al crear el agente)" value={`${base}/api/elevenlabs/initiation`} />
              <CopyRow label="Automatización: recordatorios (n8n)" value={`${base}/api/automations/recordatorios`} />
              <CopyRow label="Automatización: recall (n8n)" value={`${base}/api/automations/recall`} />
              <CopyRow label="Automatización: encuestas post-consulta (n8n)" value={`${base}/api/automations/encuestas`} />
              <p className="text-xs text-brand-900/50">Los llamados de n8n llevan el header <code>x-turnia-secret</code> con el valor de AGENT_TOOLS_SECRET.</p>
            </div>
          </Card>

          <Card>
            <h2 className="mb-1 font-semibold text-brand-950">Audios de la web</h2>
            <p className="mb-3 text-xs text-brand-900/60">Las conversaciones que se escuchan en la home y en “Escuchá a nuestros agentes”.</p>
            <AudiosWeb items={audios} />
          </Card>
        </div>
      </div>
    </>
  );
}
