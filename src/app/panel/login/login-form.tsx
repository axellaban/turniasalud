"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

const ERRORS: Record<string, string> = {
  password: "Contraseña incorrecta.",
  config: "Falta configurar PANEL_PASSWORD en Vercel.",
};

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <form method="post" action="/api/panel/login" onSubmit={() => setPending(true)} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="password" name="password" required autoFocus placeholder="Contraseña" className={inputClass} />
      {error && ERRORS[error] && <p className="text-sm text-red-600">{ERRORS[error]}</p>}
      <button type="submit" disabled={pending} className={`${buttonClass} w-full py-2.5`}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
