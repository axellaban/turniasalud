"use client";

import { useActionState } from "react";
import { saveMessagingChannel } from "../../actions";
import { buttonClass, inputClass } from "@/components/ui";
import type { MessagingSettings } from "@/lib/messaging-settings";

export function Canales({ settings, whatsappConfigured }: {
  settings: MessagingSettings; whatsappConfigured: boolean;
}) {
  const [saved, save, saving] = useActionState(saveMessagingChannel, {});
  return <div className="space-y-4">
    <p className="text-sm text-brand-900/70">Activá o pausá el WhatsApp general. Al cambiar esta opción se cierran las conversaciones de esa línea y las demos que se iniciaron por WhatsApp.</p>
    <form action={save} className="space-y-3">
      <label className="block text-sm font-medium" htmlFor="active-channel">WhatsApp general</label>
      <select id="active-channel" name="channel" defaultValue={settings.active_channel} className={inputClass}>
        <option value="pausado">WhatsApp general pausado</option>
        <option value="whatsapp" disabled={!whatsappConfigured}>WhatsApp · conexión WAHA existente</option>
      </select>
      <button disabled={saving} className={buttonClass}>{saving ? "Guardando…" : "Guardar canal"}</button>
      {saved.message && <p role="status" className={saved.ok ? "text-sm text-green-700" : "text-sm text-red-700"}>{saved.message}</p>}
    </form>
  </div>;
}
