"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { saveCampaignTextsAction, saveSequenceAction } from "../../campaign-actions";
import { buttonClass, inputClass } from "@/components/ui";

// Panel derecho de la pantalla de Campañas: Audiencia, Secuencia y Mensaje de la campaña elegida.

type Tab = "audiencia" | "secuencia" | "mensaje";

export type SettingsProps = {
  clinicId: string;
  campaignId: string;
  rule: string;
  breakdown: { matching: number; optedOut: number; hasAppointment: number; recentCampaign: number; noPhone: number; reachable: number } | null;
  cooldownDays: number;
  delayDays: number;
  maxMessages: number;
  stopOnReply: boolean;
  stopOnBooking: boolean;
  sequencesEnabled: boolean;
  message: string;
  followup: string;
  goal: string;
  sample: { name: string; detail: string };
  optOutFooter: string;
  listHref: string;
};

const fill = (text: string, sample: { name: string; detail: string }) =>
  text.replace(/\{\s*(nombre|detalle)\s*\}/gi, (_, key: string) => (key.toLowerCase() === "nombre" ? sample.name : sample.detail));

function Status({ state, pending }: { state?: { ok?: boolean; message?: string }; pending: boolean }) {
  return (
    <span aria-live="polite" className={`text-xs ${state?.ok === false ? "text-red-600" : "text-brand-700"}`}>
      {!pending && state?.message}
    </span>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className={`flex justify-between gap-3 ${strong ? "border-t border-brand-900/10 pt-2 font-semibold text-brand-950" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

export function CampaignSettings(props: SettingsProps) {
  const [tab, setTab] = useState<Tab>("secuencia");
  const [seqState, seqAction, seqPending] = useActionState(saveSequenceAction, undefined);
  const [msgState, msgAction, msgPending] = useActionState(saveCampaignTextsAction, undefined);
  const [step, setStep] = useState<1 | 2>(1);
  const [message, setMessage] = useState(props.message);
  const [followup, setFollowup] = useState(props.followup);
  const [max, setMax] = useState(String(props.maxMessages));
  const b = props.breakdown;
  const tabs: Array<[Tab, string]> = [
    ["audiencia", "Audiencia"],
    ["secuencia", "Secuencia"],
    ["mensaje", "Mensaje"],
  ];

  return (
    <div>
      <div role="tablist" aria-label="Ajustes de la campaña" className="flex border-b border-brand-900/10">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            id={`tab-${key}`}
            aria-selected={tab === key}
            aria-controls={`panel-${key}`}
            onClick={() => setTab(key)}
            className={`min-h-11 flex-1 border-b-2 text-sm font-semibold ${tab === key ? "border-brand-600 text-brand-700" : "border-transparent text-brand-900/65 hover:text-brand-900"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "audiencia" && (
        <div role="tabpanel" id="panel-audiencia" aria-labelledby="tab-audiencia" className="space-y-4 pt-4 text-sm">
          <p className="text-brand-900/75">{props.rule}</p>
          {b ? (
            <div className="space-y-1.5 rounded-xl bg-brand-50/60 p-3 text-brand-900/75">
              <Row label="Cumplen la regla" value={b.matching.toLocaleString("es-AR")} />
              {b.hasAppointment > 0 && <Row label="Ya tienen turno" value={`−${b.hasAppointment}`} />}
              {b.recentCampaign > 0 && <Row label={`Recibieron otra campaña hace menos de ${props.cooldownDays} días`} value={`−${b.recentCampaign}`} />}
              {b.optedOut > 0 && <Row label="Pidieron no recibir mensajes" value={`−${b.optedOut}`} />}
              {b.noPhone > 0 && <Row label="Sin celular válido" value={`−${b.noPhone}`} />}
              <Row label="Se les puede escribir" value={b.reachable.toLocaleString("es-AR")} strong />
            </div>
          ) : (
            <p className="text-brand-900/65">Es una lista armada a mano: no se recalcula.</p>
          )}
          <Link href={props.listHref} className="inline-block font-medium text-brand-700 underline underline-offset-2">
            Ver y editar la lista
          </Link>
        </div>
      )}

      {tab === "secuencia" && (
        <form action={seqAction} role="tabpanel" id="panel-secuencia" aria-labelledby="tab-secuencia" className="space-y-4 pt-4 text-sm">
          <input type="hidden" name="clinic_id" value={props.clinicId} />
          <input type="hidden" name="id" value={props.campaignId} />
          {!props.sequencesEnabled && (
            <p className="rounded-xl bg-sun-100 px-3 py-2 text-xs text-sun-700">
              El seguimiento está apagado en esta clínica: por ahora sale solo el primer mensaje. Lo prende el equipo de Turnia.
            </p>
          )}
          <ol className="space-y-3">
            <li className="flex gap-3">
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">1</span>
              <span>
                <b className="text-brand-950">Primer mensaje</b>
                <span className="block text-xs text-brand-900/65">Apenas entra a la campaña, en el próximo lote.</span>
              </span>
            </li>
            <li className={`flex gap-3 ${max === "1" ? "opacity-50" : ""}`}>
              <span className="grid size-7 shrink-0 place-items-center rounded-full bg-brand-600 text-xs font-bold text-white">2</span>
              <span className="min-w-0">
                <b className="text-brand-950">Seguimiento</b>
                <label className="mt-1 flex flex-wrap items-center gap-2 text-xs text-brand-900/75">
                  Si no responde en
                  <select name="delay_days" defaultValue={String(props.delayDays)} disabled={max === "1"} className="rounded-lg border border-brand-900/15 bg-white px-2 py-1.5 text-sm">
                    {[3, 5, 7, 10, 14].map((d) => (
                      <option key={d} value={d}>
                        {d} días
                      </option>
                    ))}
                  </select>
                </label>
                {max === "1" && <input type="hidden" name="delay_days" value={props.delayDays} />}
              </span>
            </li>
            <li className="flex gap-3 text-brand-900/55">
              <span className="grid size-7 shrink-0 place-items-center rounded-full border border-dashed border-brand-900/25 text-xs">+</span>
              <span>
                <b>Llamada de Sofi</b>
                <span className="block text-xs">Próximamente: necesita autorización por campaña.</span>
              </span>
            </li>
          </ol>
          <label className="block">
            <span className="font-medium text-brand-900">Mensajes por paciente, como máximo</span>
            <select name="max_messages" value={max} onChange={(e) => setMax(e.target.value)} className={`mt-1 ${inputClass}`}>
              <option value="1">1 (sin seguimiento)</option>
              <option value="2">2</option>
            </select>
          </label>
          <fieldset className="space-y-1.5">
            <legend className="mb-1 font-medium text-brand-900">Se corta la secuencia si</legend>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="stop_on_reply" defaultChecked={props.stopOnReply} /> Responde
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" name="stop_on_booking" defaultChecked={props.stopOnBooking} /> Saca turno, por cualquier canal
            </label>
            <label className="flex items-center gap-2 text-brand-900/65">
              <input type="checkbox" checked disabled readOnly /> Pide no recibir más mensajes (siempre)
            </label>
          </fieldset>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={seqPending} className={buttonClass}>
              {seqPending ? "Guardando…" : "Guardar secuencia"}
            </button>
            <Status state={seqState} pending={seqPending} />
          </div>
        </form>
      )}

      {tab === "mensaje" && (
        <form action={msgAction} role="tabpanel" id="panel-mensaje" aria-labelledby="tab-mensaje" className="space-y-4 pt-4 text-sm">
          <input type="hidden" name="clinic_id" value={props.clinicId} />
          <input type="hidden" name="id" value={props.campaignId} />
          <div role="group" aria-label="Paso" className="flex gap-2">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                type="button"
                aria-pressed={step === n}
                onClick={() => setStep(n)}
                className={`min-h-9 rounded-full px-3 text-xs font-semibold ${step === n ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-800 ring-1 ring-brand-200"}`}
              >
                {n === 1 ? "Paso 1 · primer mensaje" : "Paso 2 · seguimiento"}
              </button>
            ))}
          </div>
          <div className="rounded-xl bg-[#e9f2e6] p-3">
            <p className="ml-auto max-w-[90%] whitespace-pre-line rounded-xl rounded-br-sm bg-[#dcf8c6] px-3 py-2 text-[15px] leading-snug text-brand-950">
              {fill(step === 1 ? message : followup, props.sample)}
              {"\n\n"}
              <span className="text-xs text-brand-900/65">{props.optOutFooter}</span>
            </p>
          </div>
          <label className={`block ${step === 1 ? "" : "hidden"}`}>
            <span className="font-medium text-brand-900">Texto del primer mensaje</span>
            <textarea name="message" rows={4} maxLength={900} value={message} onChange={(e) => setMessage(e.target.value)} className={`mt-1 ${inputClass}`} />
          </label>
          <label className={`block ${step === 2 ? "" : "hidden"}`}>
            <span className="font-medium text-brand-900">Texto del seguimiento</span>
            <textarea name="followup" rows={3} maxLength={900} value={followup} onChange={(e) => setFollowup(e.target.value)} className={`mt-1 ${inputClass}`} />
          </label>
          <p className="text-xs text-brand-900/65">
            <code>{"{nombre}"}</code> es el nombre de pila y <code>{"{detalle}"}</code> lo de cada paciente (por ejemplo, «{props.sample.detail}»).
          </p>
          <label className="block">
            <span className="font-medium text-brand-900">Si responde, Sofi tiene que</span>
            <input name="goal" defaultValue={props.goal} className={`mt-1 ${inputClass}`} />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button disabled={msgPending} className={buttonClass}>
              {msgPending ? "Guardando…" : "Guardar mensajes"}
            </button>
            <Status state={msgState} pending={msgPending} />
          </div>
        </form>
      )}
    </div>
  );
}
