"use client";
import { useActionState, useState } from "react";
import { createAccess, type AccessState } from "../../clinics-actions";
import { Field, Notice, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";

/** Crea el código del consultorio y lo muestra una sola vez, listo para copiar. */
export function AccessCreator({ clinicId, loginUrl }: { clinicId: string; loginUrl: string }) {
  const [state, action, pending] = useActionState<AccessState, FormData>(createAccess, {});
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); setCopied(what); } catch { setCopied(null); }
  };
  const message = state.code ? `Entrá a ${loginUrl} con este código: ${state.code}` : "";
  return <div className="space-y-3">
    <form action={action} className="flex flex-wrap items-end gap-2">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <div className="min-w-0 flex-1"><Field label="Para quién (opcional)"><input name="label" maxLength={80} placeholder="Dr. Guerra" className={inputClass} /></Field></div>
      <button disabled={pending} className={buttonClass}>{pending ? "Creando…" : "Crear código"}</button>
    </form>
    {state.code && <Notice tone="success">
      <p className="font-medium">Código de acceso</p>
      <p className="mt-1 select-all font-mono text-lg tracking-wider text-brand-950">{state.code}</p>
      <p className="mt-1 text-xs text-brand-900/70">{state.message} Se ingresa en <span className="break-all">{loginUrl}</span>.</p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button type="button" onClick={() => copy(state.code!, "code")} className={secondaryButtonClass}>{copied === "code" ? "Copiado ✓" : "Copiar código"}</button>
        <button type="button" onClick={() => copy(message, "message")} className={secondaryButtonClass}>{copied === "message" ? "Copiado ✓" : "Copiar mensaje con link"}</button>
      </div>
    </Notice>}
  </div>;
}
