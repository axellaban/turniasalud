"use client";

import { useActionState } from "react";
import { saveDemoLimit } from "../../actions";
import { submitKeepingValues } from "@/components/keep-form";
import { buttonClass, inputClass } from "@/components/ui";

/** Cuántas demos nuevas puede pedir una misma persona por día (0 = sin límite). */
export function DemoLimitForm({ limit }: { limit: number | null }) {
  const [state, action, pending] = useActionState(saveDemoLimit, {});
  return (
    <form onSubmit={submitKeepingValues(action)} className="space-y-2">
      <label htmlFor="demo-limit" className="block text-sm font-medium text-brand-900">Demos por persona por día</label>
      <div className="flex gap-2">
        <input id="demo-limit" name="demo_daily_limit" type="number" min={0} max={1000} defaultValue={limit ?? 0} className={`${inputClass} max-w-32`} />
        <button disabled={pending} className={buttonClass}>{pending ? "Guardando…" : "Guardar"}</button>
      </div>
      <p className="text-xs text-brand-900/55">0 = sin límite. Cada demo lee una web y usa créditos de Claude; si la landing recibe abusos, poné un tope (por ejemplo, 5).</p>
      {state.message && <p role="status" className={`text-sm ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</p>}
    </form>
  );
}
