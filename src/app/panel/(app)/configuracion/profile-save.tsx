"use client";
import { useActionState, type ReactNode } from "react";
import { saveClinicWithFeedback } from "../../actions";
import { buttonClass } from "@/components/ui";

export function ProfileSaveForm({ clinicId, revision, children }: { clinicId: string; revision: number; children: ReactNode }) {
  const [state, action, pending] = useActionState(saveClinicWithFeedback, {});
  return <form action={action} className="grid gap-4 sm:grid-cols-2">
    <input type="hidden" name="clinic_id" value={clinicId} /><fieldset key={revision} className="contents">{children}</fieldset>
    <div className="sm:col-span-2"><button disabled={pending} className={buttonClass}>{pending ? "Guardando…" : "Guardar cambios"}</button>
      {state.message && <p role="status" className={`mt-2 text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
    </div>
  </form>;
}
