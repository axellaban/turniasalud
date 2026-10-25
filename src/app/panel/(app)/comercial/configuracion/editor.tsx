"use client";

import { useActionState, useState } from "react";
import { Field, inputClass, Notice, buttonClass, secondaryButtonClass } from "@/components/ui";
import type { SalesConfiguration } from "@/lib/sales/config";
import type { SalesVoice } from "@/lib/sales/agent";
import { salesAction, type SalesActionState } from "../actions";

type Draft = SalesConfiguration & { voice_id: string; version: number };
export function SalesConfigEditor({ initial, voices, hasPrevious }: { initial: Draft; voices: SalesVoice[]; hasPrevious: boolean }) {
  const [draft, setDraft] = useState(initial);
  const [saved, setSaved] = useState(initial);
  const [state, action, pending] = useActionState(async (previous: SalesActionState, data: FormData) => {
    const result = await salesAction(previous, data);
    if (result.configuration) { setDraft(result.configuration); setSaved(result.configuration); }
    return result;
  }, {});
  const dirty = draft.first_message !== saved.first_message || draft.system_prompt !== saved.system_prompt || draft.voice_id !== saved.voice_id;
  return <form action={action} className="space-y-5">
    <input type="hidden" name="config_version" value={draft.version} />
    <fieldset disabled={pending} className="space-y-5">
      <Field label="Saludo inicial" hint="Lo primero que dice al atender. Presentala como asistente de IA. {{business_name}} se reemplaza por el nombre del consultorio.">
        <textarea name="first_message" className={inputClass} rows={4} minLength={15} maxLength={1000} required value={draft.first_message} onChange={e=>setDraft({...draft,first_message:e.target.value})} />
      </Field>
      <Field label="Instrucciones / system prompt" hint="Definí el objetivo, el pitch, el tono, las preguntas y cómo responder objeciones. El contexto específico se carga en la ficha de cada consultorio.">
        <textarea name="system_prompt" className={`${inputClass} min-h-96`} rows={22} minLength={80} maxLength={20000} required value={draft.system_prompt} onChange={e=>setDraft({...draft,system_prompt:e.target.value})} />
      </Field>
      <p className="text-xs text-brand-900/65">{draft.system_prompt.length.toLocaleString("es-AR")} / 20.000 caracteres</p>
      <Field label="Voz comercial" hint="Solo voces guardadas compatibles. No se crean ni se clonan voces.">
        <select name="voice_id" className={inputClass} required value={draft.voice_id} onChange={e=>setDraft({...draft,voice_id:e.target.value})}>
          <option value="sofi">Usar la misma voz de la recepcionista Sofi</option>
          {draft.voice_id !== "sofi" && !voices.some(v=>v.voice_id===draft.voice_id) && <option value={draft.voice_id}>Voz actual guardada</option>}
          {voices.map(v=><option key={v.voice_id} value={v.voice_id} disabled={v.live_moderated}>{v.name}{v.live_moderated ? " — No apta para agentes" : ""}</option>)}
        </select>
      </Field>
      <div className="rounded-xl bg-brand-50 p-4 text-sm">
        <p className="font-semibold">Se conservan las conexiones del agente</p>
        <p className="mt-1">El registro de interés, la baja y el cierre de llamada siguen conectados. La llamada comercial no atiende pacientes ni envía mensajes. El límite sigue en 60 segundos de conversación más despedida.</p>
      </div>
      {dirty && <p role="status" className="text-sm font-medium">Tenés cambios sin aplicar.</p>}
      <button className={buttonClass} name="intent" value="configure">{pending ? "Guardando y comprobando…" : "Guardar y aplicar en ElevenLabs"}</button>
      <p className="text-sm">Al aplicar, el piloto queda pausado. Después habilitás el cupo de hoy y confirmás cada llamada desde su ficha.</p>
      {hasPrevious && <details className="border-t border-brand-900/10 pt-4"><summary className="cursor-pointer font-semibold text-sm">Restaurar la versión anterior</summary><p className="text-sm my-3">Recupera el saludo, las instrucciones y la voz de la versión anterior, los aplica en ElevenLabs y crea una nueva versión. Reemplaza el borrador de este formulario.</p><button className={secondaryButtonClass} name="intent" value="restore_config" formNoValidate>Restaurar y aplicar versión anterior</button></details>}
    </fieldset>
    {state.error && <Notice tone="error">{state.error} Tu texto sigue en el formulario.</Notice>}
    {state.message && <Notice tone="success">{state.message}</Notice>}
  </form>;
}
