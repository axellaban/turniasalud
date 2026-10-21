"use client";

import { useActionState } from "react";
import { login } from "../actions";
import { buttonClass, inputClass } from "@/components/ui";

export function LoginForm({ next }: { next: string }) {
  const [state, action, pending] = useActionState(login, undefined);
  return (
    <form action={action} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="password" name="password" required autoFocus placeholder="Contraseña" className={inputClass} />
      {state?.error && <p className="text-sm text-red-600">{state.error}</p>}
      <button type="submit" disabled={pending} className={`${buttonClass} w-full py-2.5`}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
