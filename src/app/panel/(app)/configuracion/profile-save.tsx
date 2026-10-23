"use client";
import { useActionState, useEffect, useRef, useState, type ReactNode } from "react";
import { saveClinicWithFeedback } from "../../actions";
import { buttonClass, ghostButtonClass } from "@/components/ui";

const LEAVE = "Tenés cambios sin guardar. ¿Salir igual y perderlos?";

/**
 * Formulario del perfil con una barra fija de guardado: avisa si hay cambios
 * sin guardar y pide confirmación antes de salir de la página.
 */
export function ProfileSaveForm({ clinicId, revision, children }: { clinicId: string; revision: number; children: ReactNode }) {
  const [state, action, pending] = useActionState(saveClinicWithFeedback, {});
  const form = useRef<HTMLFormElement>(null);
  // Guardar con éxito incrementa la revisión: el formulario deja de estar «sucio» solo.
  const [dirtyAt, setDirtyAt] = useState<number | null>(null);
  const dirty = dirtyAt === revision;

  useEffect(() => {
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const click = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      if (!confirm(LEAVE)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [dirty]);

  const failed = !pending && state.ok === false;
  const status = pending ? "Guardando…" : failed ? state.message : dirty ? "Tenés cambios sin guardar" : state.message ?? "Todo guardado";
  const tone = failed ? "text-red-700" : dirty ? "text-sun-600" : state.ok ? "text-brand-700" : "text-brand-900/60";
  return <form ref={form} action={action} onInput={() => setDirtyAt(revision)} className="space-y-6">
    <input type="hidden" name="clinic_id" value={clinicId} /><fieldset key={revision} className="contents">{children}</fieldset>
    <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-900/10 bg-white/95 px-4 py-3 shadow-lg backdrop-blur md:bottom-4">
      <p role="status" className={`text-sm font-medium ${tone}`}>{status}</p>
      <div className="flex gap-2">
        {dirty && !pending && <button type="button" onClick={() => { form.current?.reset(); setDirtyAt(null); }} className={ghostButtonClass}>Descartar</button>}
        <button disabled={pending} className={buttonClass}>{pending ? "Guardando…" : "Guardar cambios"}</button>
      </div>
    </div>
  </form>;
}
