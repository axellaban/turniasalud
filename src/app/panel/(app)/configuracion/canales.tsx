"use client";

import { useActionState } from "react";
import { saveMessagingChannel, setupTelegramChannel } from "../../actions";
import { buttonClass, inputClass } from "@/components/ui";
import type { MessagingSettings } from "@/lib/messaging-settings";

export function Canales({ settings, telegramConfigured, whatsappConfigured }: {
  settings: MessagingSettings; telegramConfigured: boolean; whatsappConfigured: boolean;
}) {
  const [saved, save, saving] = useActionState(saveMessagingChannel, {});
  const [connected, connect, connecting] = useActionState(setupTelegramChannel, {});
  return <div className="space-y-4">
    <p className="text-sm text-brand-900/70">Elegí dónde responde Turnia y adónde lleva el botón Probar demo. El otro canal queda pausado. Al cambiar se terminan las demos anteriores.</p>
    <form action={save} className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="active-channel">Canal habilitado</label>
      <select id="active-channel" name="channel" defaultValue={settings.active_channel} className={inputClass}>
        <option value="pausado">Pausado — no responde en ningún canal</option>
        <option value="telegram" disabled={!telegramConfigured || !settings.telegram_ready}>Telegram · @TurnIA_salud_bot</option>
        <option value="whatsapp" disabled={!whatsappConfigured}>WhatsApp · conexión WAHA existente</option>
      </select>
      <button disabled={saving || connecting} className={buttonClass}>{saving ? "Guardando…" : "Guardar canal"}</button>
      {saved.message && <p role="status" className={saved.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{saved.message}</p>}
    </form>
    <div className="border-t border-brand-900/10 pt-4">
      <p className="text-sm font-medium">Telegram · @TurnIA_salud_bot</p>
      <p className="mt-1 text-xs text-brand-900/60">{settings.telegram_ready ? "Webhook conectado. Elegí Telegram arriba para habilitarlo." : "Conectá este bot a Turnia antes de habilitarlo."} Audio entrante y notas de voz con ElevenLabs. Las llamadas se abren en el navegador.</p>
      <form action={connect} className="mt-3">
        <button disabled={!telegramConfigured || connecting || saving} className={buttonClass}>{connecting ? "Conectando…" : "Conectar bot de Telegram"}</button>
        {!telegramConfigured && <p className="mt-2 text-xs text-red-700">Falta TELEGRAM_BOT_TOKEN o la conexión del agente en Vercel.</p>}
        {connected.message && <p role="status" className={`mt-2 text-sm ${connected.ok ? "text-green-700" : "text-red-700"}`}>{connected.message}</p>}
      </form>
    </div>
  </div>;
}
