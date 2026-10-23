"use client";
import { useActionState, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { saveClinicWithFeedback } from "../../actions";
import { submitKeepingValues } from "@/components/keep-form";
import { setUnsavedChanges } from "@/components/unsaved-changes";
import { Notice, buttonClass, ghostButtonClass } from "@/components/ui";

const LEAVE = "Tenés cambios sin guardar. ¿Salir igual y perderlos?";
const DRAFT_EVENT = "turnia-borrador";
const PREFIX = "turnia-borrador:";

type Draft = { savedAt: string; values: Record<string, string> };

// El borrador vive en este navegador: sobrevive a una recarga, a un corte o a un
// deploy en el medio. Está atado a la revisión de la ficha: si otra persona
// guardó después, no se ofrece (pisaría sus cambios).
function readDraft(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function writeDraft(key: string, draft: Draft | null) {
  try { if (draft) localStorage.setItem(key, JSON.stringify(draft)); else localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
  window.dispatchEvent(new Event(DRAFT_EVENT));
}
function subscribe(callback: () => void) {
  window.addEventListener(DRAFT_EVENT, callback);
  window.addEventListener("storage", callback);
  return () => { window.removeEventListener(DRAFT_EVENT, callback); window.removeEventListener("storage", callback); };
}

/**
 * Formulario del perfil con una barra fija de guardado: avisa si hay cambios
 * sin guardar, pide confirmación antes de salir y, si algo falla al guardar,
 * conserva lo escrito.
 */
export function ProfileSaveForm({ clinicId, revision, children }: { clinicId: string; revision: number; children: ReactNode }) {
  const [state, action, pending] = useActionState(saveClinicWithFeedback, {});
  const form = useRef<HTMLFormElement>(null);
  const key = `${PREFIX}${clinicId}:${revision}`;
  // Guardar con éxito incrementa la revisión: el formulario deja de estar «sucio» solo.
  const [dirtyAt, setDirtyAt] = useState<number | null>(null);
  const dirty = dirtyAt === revision;
  const stored = useSyncExternalStore(subscribe, () => readDraft(key), () => null);
  const draft: Draft | null = (() => { try { return stored ? JSON.parse(stored) as Draft : null; } catch { return null; } })();

  useEffect(() => {
    setUnsavedChanges(dirty);
    if (!dirty) return;
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ""; };
    const click = (e: MouseEvent) => {
      const link = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!link || link.target === "_blank" || link.getAttribute("href")?.startsWith("#") || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
      if (!confirm(LEAVE)) { e.preventDefault(); e.stopPropagation(); }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", click, true);
    return () => { setUnsavedChanges(false); window.removeEventListener("beforeunload", beforeUnload); document.removeEventListener("click", click, true); };
  }, [dirty]);

  // Al guardar (revisión nueva) se descartan los borradores anteriores de esta clínica.
  useEffect(() => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith(`${PREFIX}${clinicId}:`) && k !== key) localStorage.removeItem(k);
    } catch { /* sin almacenamiento */ }
  }, [clinicId, key]);

  const remember = () => {
    setDirtyAt(revision);
    if (!form.current) return;
    const values: Record<string, string> = {};
    for (const [name, value] of new FormData(form.current)) if (typeof value === "string" && name !== "clinic_id") values[name] = value;
    writeDraft(key, { savedAt: new Date().toISOString(), values });
  };
  const restore = () => {
    if (!form.current || !draft) return;
    for (const [name, value] of Object.entries(draft.values)) {
      const field = form.current.elements.namedItem(name);
      if (field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement || field instanceof HTMLSelectElement) field.value = value;
    }
    form.current.dispatchEvent(new Event("reset-chips", { bubbles: false }));
    setDirtyAt(revision);
  };
  const discard = () => { form.current?.reset(); setDirtyAt(null); writeDraft(key, null); };

  const failed = !pending && state.ok === false;
  const status = pending ? "Guardando…" : failed ? state.message : dirty ? "Tenés cambios sin guardar" : state.message ?? "Todo guardado";
  const tone = failed ? "text-red-700" : dirty ? "text-sun-600" : state.ok ? "text-brand-700" : "text-brand-900/60";
  return <form ref={form} onSubmit={submitKeepingValues(action)} onInput={remember} className="space-y-6">
    {draft && !dirty && <Notice tone="warning" className="flex flex-wrap items-center justify-between gap-2">
      <span>Quedaron cambios sin guardar de {new Date(draft.savedAt).toLocaleString("es-AR", { dateStyle: "short", timeStyle: "short" })}.</span>
      <span className="flex gap-2">
        <button type="button" onClick={restore} className={ghostButtonClass}>Recuperarlos</button>
        <button type="button" onClick={() => writeDraft(key, null)} className={ghostButtonClass}>Descartar</button>
      </span>
    </Notice>}
    <input type="hidden" name="clinic_id" value={clinicId} /><fieldset key={revision} className="contents">{children}</fieldset>
    <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-brand-900/10 bg-white/95 px-4 py-3 shadow-lg backdrop-blur md:bottom-4">
      <p role="status" className={`text-sm font-medium ${tone}`}>{status}</p>
      <div className="flex flex-wrap gap-2">
        {dirty && !pending && <button type="button" onClick={discard} className={ghostButtonClass}>Descartar</button>}
        {!dirty && state.ok && <a href="#probar" className={ghostButtonClass}>Probar los cambios ↓</a>}
        <button disabled={pending} className={buttonClass}>{pending ? "Guardando…" : "Guardar cambios"}</button>
      </div>
    </div>
  </form>;
}
