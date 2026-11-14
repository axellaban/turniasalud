"use client";

import { useActionState } from "react";
import { prepareTestLink, type ProfileTestState } from "../../clinics-actions";
import { buttonClass, secondaryButtonClass } from "@/components/ui";
import { PanelIcon } from "@/components/panel-icons";

/**
 * Prepara el enlace que abre la prueba por el WhatsApp general con la ficha de esta clínica y lo muestra con su QR, para abrirlo en el celular desde la compu.
 */
export function TestLink({ clinicId, label }: { clinicId: string; label: string }) {
  const [state, action, pending] = useActionState<ProfileTestState, FormData>(prepareTestLink, {});
  if (state.ok && state.url) {
    return (
      <div className="flex flex-wrap items-center gap-4">
        <div className="space-y-2">
          <a href={state.url} target="_blank" rel="noreferrer" className={buttonClass}>
            {label}
            <PanelIcon name="externo" className="h-4 w-4" />
          </a>
          <p role="status" className="text-xs text-brand-900/65">{state.message}</p>
        </div>
        {state.qr && <Qr svg={state.qr} />}
      </div>
    );
  }
  return (
    <form action={action} className="space-y-2">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <button disabled={pending} className={secondaryButtonClass}>{pending ? "Preparando…" : "Preparar el enlace"}</button>
      {state.message && !state.ok && <p role="status" className="text-sm text-red-700">{state.message}</p>}
    </form>
  );
}

/** El QR solo sirve en la compu: en el celular se toca el botón. */
export function Qr({ svg }: { svg: string }) {
  return (
    <figure className="hidden items-center gap-3 md:flex">
      {/* El SVG lo arma la librería qrcode en el servidor, con el enlace de Turnia: no trae HTML de afuera. */}
      <span className="block h-24 w-24 shrink-0 rounded-lg ring-1 ring-brand-900/10 [&>svg]:h-full [&>svg]:w-full" dangerouslySetInnerHTML={{ __html: svg }} />
      <figcaption className="max-w-[9rem] text-xs leading-snug text-brand-900/65">Escanealo con la cámara del celular.</figcaption>
    </figure>
  );
}
