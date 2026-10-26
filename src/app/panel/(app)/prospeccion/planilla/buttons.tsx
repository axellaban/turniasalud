"use client";

import { useActionState } from "react";
import { Notice, buttonClass, secondaryButtonClass } from "@/components/ui";
import { disconnectAction, recreateAction, syncNowAction } from "./actions";

/** Copiar ahora (o crear la planilla, si no hay o se borró) y desconectar. */
export function SheetButtons({ missing, first }: { missing: boolean; first: boolean }) {
  const [syncState, sync, syncing] = useActionState(missing ? recreateAction : syncNowAction, undefined);
  const [offState, off, leaving] = useActionState(disconnectAction, undefined);
  const state = offState ?? syncState;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-3">
        <form action={sync}>
          <button disabled={syncing} className={missing ? buttonClass : secondaryButtonClass}>
            {syncing ? "Copiando…" : missing ? (first ? "Crear la planilla" : "Crear una planilla nueva") : "Copiar ahora"}
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
