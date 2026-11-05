"use client";

import { useState } from "react";
import { analyticsId, track } from "@/lib/analytics";

type Datos = { website: string } | { nombre: string; direccion: string | null; especialidad: string; profesional: string | null; servicios: string | null };

const ESTILO = {
  primario: "rounded-xl bg-brand-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-700 disabled:opacity-60",
  secundario: "rounded-xl bg-white px-6 py-3.5 text-[15px] font-semibold text-brand-800 ring-1 ring-brand-950/10 hover:bg-brand-50 disabled:opacity-60",
} as const;

/** Arranca la demo con los datos de su consultorio, sin pedirle nada: un toque y Sofi lo atiende. */
export function EmpezarDemo({
  code,
  datos,
  contar,
  variante = "primario",
  children = "Probar la demo",
}: {
  code: string;
  datos: Datos;
  contar: boolean;
  /** Secundario cuando ya la probó: lo principal pasa a ser escribirle a Axel. */
  variante?: keyof typeof ESTILO;
  children?: React.ReactNode;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function empezar() {
    setPending(true);
    setError(null);
    const props = { source: "personal", via: "navegador", with_web: "website" in datos };
    // Sale en el acto: la navegación a la demo viene enseguida.
    track("demo_started", props, true);
    let status = 0;
    try {
      const response = await fetch("/api/demo/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...datos, via: "navegador", ...(contar ? { ref: code } : {}), ph: analyticsId() }),
      });
      status = response.status;
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo abrir la demo.");
      window.location.assign(result.url);
    } catch (e) {
      track("demo_start_failed", { ...props, error_kind: status ? `api_${status}` : "network" });
      setError(e instanceof Error ? e.message : "No se pudo abrir la demo.");
      setPending(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={empezar} disabled={pending} className={`w-full sm:w-auto ${ESTILO[variante]}`}>
        {pending ? "Preparando tu demo…" : children}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
