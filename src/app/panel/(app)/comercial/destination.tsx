"use client";

import { useState } from "react";
import { Field, inputClass } from "@/components/ui";
import { SalesForm } from "./form";

export function CallDestination({ id, phone, requestKey, enabled, pendingCall }: { id: string; phone: string; requestKey: string; enabled: boolean; pendingCall: boolean }) {
  const [draft, setDraft] = useState(phone);
  const normalized = draft.replace(/[\s()-]/g, "").replace(/^00/, "+");
  const dirty = normalized !== phone;
  return <div className="space-y-4">
    <SalesForm intent="phone" label="Guardar número" disabled={pendingCall}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="expected_phone" value={phone} />
      <Field label="Teléfono a llamar" hint="Podés escribir otro número acá. Usá +54 9 y diez dígitos para un celular argentino; guardá antes de llamar.">
        <input name="phone" type="tel" autoComplete="tel" className={inputClass} required value={draft} onChange={e => setDraft(e.target.value)} />
      </Field>
    </SalesForm>
    {dirty && <p role="status" className="text-sm font-semibold text-amber-800">Tenés un número sin guardar. Guardalo antes de confirmar la llamada.</p>}
    <SalesForm intent="dial" label="Llamar ahora" disabled={!enabled || dirty}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="request_key" value={requestKey} /><input type="hidden" name="expected_phone" value={phone} />
      <label className="flex gap-3 rounded-xl border border-brand-200 bg-brand-50 p-4 text-sm"><input type="checkbox" name="confirm" required /> Autorizo una llamada grabada ahora a {phone}, con el cupo de hoy.</label>
    </SalesForm>
  </div>;
}
