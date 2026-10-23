"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

const ERRORS: Record<string, string> = {
  password: "Contraseña o código incorrecto.",
  config: "Falta configurar PANEL_PASSWORD en Vercel.",
  revoked: "Este acceso ya no está habilitado. Pedile un código nuevo a Turnia.",
  unavailable: "No pudimos verificar el código. Probá de nuevo en un momento.",
};

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [pending, setPending] = useState(false);
  return (
    <form method="post" action="/api/panel/login" onSubmit={() => setPending(true)} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <input type="password" name="password" required autoFocus autoComplete="current-password" placeholder="Contraseña o código" aria-label="Contraseña o código de acceso" className={inputClass} />
      {error && ERRORS[error] && <p className="text-sm text-red-600">{ERRORS[error]}</p>}
      <button type="submit" disabled={pending} className={`${buttonClass} w-full py-2.5`}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
    </form>
  );
}
