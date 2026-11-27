"use client";

import { useActionState, type ReactNode } from "react";
import { buttonClass } from "@/components/ui";
import type { LabFormState } from "../../lab-actions";

/** Un formulario del laboratorio: manda a una acción del servidor y muestra el resultado debajo. */
export function LabForm({
  action,
  children,
  submit,
  pending: pendingLabel = "Un momento…",
  className = "",
  button = buttonClass,
  confirm,
}: {
  action: (prev: LabFormState, form: FormData) => Promise<LabFormState>;
  children?: ReactNode;
  submit: string;
  pending?: string;
  className?: string;
  button?: string;
  confirm?: string;
}) {
  const [state, formAction, pending] = useActionState<LabFormState, FormData>(action, undefined);
  return (
    <form
      action={formAction}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
      <button disabled={pending} className={button}>
        {pending ? pendingLabel : submit}
      </button>
      {state?.message && (
        <p role="status" className={`mt-2 break-words text-sm ${state.ok ? "text-emerald-700" : "text-red-700"}`}>
          {state.message}
        </p>
      )}
    </form>
  );
}
