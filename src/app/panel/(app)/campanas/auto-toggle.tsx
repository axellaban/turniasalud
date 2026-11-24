"use client";

import { useFormStatus } from "react-dom";
import { setAutoCampaignAction, setSequencesAction } from "../../campaign-actions";

function ToggleButton({ on, label }: { on: boolean; label: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      role="switch"
      aria-checked={on}
      aria-label={`${label}: ${on ? "prendida" : "apagada"}`}
      disabled={pending}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition disabled:opacity-50 ${on ? "bg-emerald" : "bg-brand-900/20"}`}
    >
      <span className={`inline-block h-5 w-5 rounded-full bg-white shadow transition ${on ? "translate-x-6" : "translate-x-1"}`} />
    </button>
  );
}

/** Interruptor de una campaña automática (solo el administrador). Prenderla pide confirmación. */
export function AutoToggle({ clinicId, type, label, on }: { clinicId: string; type?: string; label: string; on: boolean }) {
  return (
    <form
      action={type ? setAutoCampaignAction : setSequencesAction}
      onSubmit={(e) => {
        if (!on && !window.confirm(`«${label}» va a salir sola y le va a escribir a pacientes reales sin que nadie revise la lista. ¿El consultorio ya validó el canal, los destinatarios y la baja?`)) e.preventDefault();
      }}
    >
      <input type="hidden" name="clinic_id" value={clinicId} />
      {type && <input type="hidden" name="type" value={type} />}
      <input type="hidden" name="enabled" value={on ? "0" : "1"} />
      <ToggleButton on={on} label={label} />
    </form>
  );
}
