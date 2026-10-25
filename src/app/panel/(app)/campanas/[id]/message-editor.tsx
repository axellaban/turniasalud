"use client";

import { useActionState } from "react";
import { saveCampaignMessageAction } from "../../../campaign-actions";
import { secondaryButtonClass } from "@/components/ui";

const fieldClass = "w-full rounded-xl border border-brand-900/15 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500";

export function MessageEditor({
  clinicId,
  campaignId,
  message,
  suggested,
  goal,
  example,
  official,
}: {
  clinicId: string;
  campaignId: string;
  message: string | null;
  suggested: string;
  goal: string;
  example: string;
  /** Nombre del template de Meta cuando la clínica usa el WhatsApp oficial. */
  official: string | null;
}) {
  const [state, action, pending] = useActionState(saveCampaignMessageAction, undefined);
  return (
    <details className="group mt-4 border-t border-brand-900/5 pt-3" open={state?.ok === false}>
      <summary className="cursor-pointer text-sm font-medium text-brand-700">Editar el mensaje y lo que hace Sofi</summary>
      <form action={action} className="mt-3 space-y-3 text-sm">
        <input type="hidden" name="clinic_id" value={clinicId} />
        <input type="hidden" name="id" value={campaignId} />
        <label className="block">
          <span className="font-medium text-brand-900">Mensaje</span>
          <textarea name="message" rows={4} defaultValue={message ?? suggested} maxLength={900} className={`mt-1 ${fieldClass}`} />
          <span className="mt-1 block text-xs text-brand-900/65">
            <code>{"{nombre}"}</code> es el nombre de pila y <code>{"{detalle}"}</code> lo que corresponde a cada uno (por ejemplo, «{example}»).
            {official && ` Por el WhatsApp oficial, Sofi manda el template aprobado «${official}»; este texto vale cuando lo mandás vos o por WAHA.`}
          </span>
        </label>
        <label className="block">
          <span className="font-medium text-brand-900">Si responde, Sofi tiene que…</span>
          <textarea name="goal" rows={2} defaultValue={goal} className={`mt-1 ${fieldClass}`} />
        </label>
        <div className="flex items-center gap-3">
          <button disabled={pending} className={secondaryButtonClass}>
            {pending ? "Guardando…" : "Guardar"}
          </button>
          <span aria-live="polite" className={`text-xs ${state?.ok === false ? "text-red-600" : "text-brand-700"}`}>
            {!pending && state?.message}
          </span>
        </div>
      </form>
    </details>
  );
}
