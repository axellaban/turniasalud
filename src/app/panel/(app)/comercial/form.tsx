"use client";
import { useActionState, type ReactNode } from "react";
import Link from "next/link";
import { Notice, buttonClass } from "@/components/ui";
import { salesAction } from "./actions";

export function SalesForm({ intent, children, label, disabled = false }: { intent: string; children?: ReactNode; label: string; disabled?: boolean }) {
  const [state, action, pending] = useActionState(salesAction, {});
  return <form action={action} className="space-y-4">
    <input type="hidden" name="intent" value={intent} />
    <fieldset disabled={pending || disabled} className="space-y-4">
      {children}
      <button className={buttonClass} disabled={pending || disabled}>{pending ? "Procesando…" : label}</button>
    </fieldset>
    {state.error && <Notice tone="error">{state.error}</Notice>}
    {state.message && <Notice tone="success">{state.message}{state.prospectId && <> <Link className="underline" href={`/panel/comercial/${state.prospectId}`}>Abrir ficha</Link></>}</Notice>}
  </form>;
}
