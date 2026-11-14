"use client";

import { useActionState } from "react";
import { smallButtonClass } from "@/components/ui";
import { testNoticePhone } from "../../notice-actions";

/** «Mandar aviso de prueba»: confirma que el celular está bien cargado y que la línea manda. */
export function NoticeTestButton({ clinicId, phoneId, name }: { clinicId: string; phoneId: string; name: string }) {
  const [state, run, pending] = useActionState(testNoticePhone, {});
  return (
    <form action={run} className="flex flex-wrap items-center gap-2">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <input type="hidden" name="id" value={phoneId} />
      <button disabled={pending} className={smallButtonClass} aria-label={`Mandarle un aviso de prueba a ${name}`}>
        {pending ? "Mandando…" : "Mandar aviso de prueba"}
      </button>
      {state.message && <span role={state.ok ? "status" : "alert"} className={`text-xs ${state.ok ? "text-brand-700" : "text-red-700"}`}>{state.message}</span>}
    </form>
  );
}
