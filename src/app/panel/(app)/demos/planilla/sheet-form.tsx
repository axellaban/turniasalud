"use client";

import { useActionState, useState } from "react";
import { Notice, buttonClass, inputClass, secondaryButtonClass, smallButtonClass } from "@/components/ui";
import { connectSheetAction, disconnectSheetAction, syncAllLeadsAction } from "../sheet-actions";

export function CopyCode({ code }: { code: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="mt-2">
      <pre tabIndex={0} aria-label="Código de Apps Script" className="max-h-64 overflow-auto rounded-xl bg-brand-950 p-3 text-[11px] leading-relaxed text-brand-50">
        {code}
      </pre>
      <button
        type="button"
        onClick={() => void navigator.clipboard?.writeText(code).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }, () => {})}
        className={`${smallButtonClass} mt-2`}
      >
        {copied ? "Copiado" : "Copiar el código"}
      </button>
    </div>
  );
}

export function ConnectSheetForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(connectSheetAction, undefined);
  return (
    <form action={action} className="mt-2 space-y-2">
      <label className="block">
        <span className="sr-only">URL de la aplicación web</span>
        <input
          name="url"
          type="url"
          required
          defaultValue={current ?? ""}
          placeholder="https://script.google.com/macros/s/…/exec"
          className={inputClass}
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={buttonClass}>
          {pending ? "Probando…" : "Conectar y probar"}
        </button>
        {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
      </div>
    </form>
  );
}

export function SheetButtons() {
  const [syncState, sync, syncing] = useActionState(syncAllLeadsAction, undefined);
  const [offState, off, leaving] = useActionState(disconnectSheetAction, undefined);
  const state = syncState ?? offState;
  return (
    <div className="mt-4 space-y-3">
      <div className="flex flex-wrap gap-2">
        <form action={sync}>
          <button disabled={syncing} className={buttonClass}>
            {syncing ? "Copiando…" : "Copiar los pedidos que ya hay"}
          </button>
        </form>
        <form action={off}>
          <button disabled={leaving} className={secondaryButtonClass}>
            Desconectar
          </button>
        </form>
      </div>
      {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
    </div>
  );
}
