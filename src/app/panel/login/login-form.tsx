"use client";

import { useState } from "react";
import { buttonClass, inputClass } from "@/components/ui";

const ERRORS: Record<string, string> = {
  password: "Contraseña o código incorrecto.",
  config: "Falta configurar PANEL_PASSWORD en Vercel.",
  revoked: "Este acceso ya no está habilitado. Pedile un código nuevo a Turnia.",
  unavailable: "No pudimos verificar el código. Probá de nuevo en un momento.",
  too_many: "Demasiados intentos fallidos. Esperá 15 minutos y volvé a probar.",
};

export function LoginForm({ next, error }: { next: string; error?: string }) {
  const [pending, setPending] = useState(false);
  const [visible, setVisible] = useState(false);
  return (
    <form method="post" action="/api/panel/login" onSubmit={() => setPending(true)} className="mt-6 space-y-4">
      <input type="hidden" name="next" value={next} />
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          name="password"
          required
          autoFocus
          autoComplete="current-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="Contraseña o código"
          aria-label="Contraseña o código de acceso"
          aria-invalid={Boolean(error && ERRORS[error])}
          aria-describedby={error && ERRORS[error] ? "login-error" : undefined}
          className={`${inputClass} pr-20`}
        />
        <button type="button" onClick={() => setVisible((v) => !v)} aria-pressed={visible} className="absolute inset-y-0 right-2 my-auto h-8 rounded-lg px-2 text-xs font-medium text-brand-700 hover:bg-brand-50">
          {visible ? "Ocultar" : "Mostrar"}
        </button>
      </div>
      {error && ERRORS[error] && <p id="login-error" role="alert" className="text-sm text-red-600">{ERRORS[error]}</p>}
      <button type="submit" disabled={pending} className={`${buttonClass} w-full py-2.5`}>
        {pending ? "Ingresando…" : "Ingresar"}
      </button>
      <p className="text-center text-xs text-brand-900/55">¿Sos de un consultorio? Ingresá el código que te pasó Turnia (con o sin guiones). Si lo perdiste, pedí uno nuevo.</p>
    </form>
  );
}
