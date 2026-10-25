"use client";

import { useEffect, useState } from "react";

type Datos = { website: string } | { nombre: string; direccion: string | null; especialidad: string; profesional: string | null };

/**
 * Arranca la demo con los datos de su consultorio, sin pedirle nada: un toque y Sofi lo atiende.
 * Avisa que abrió la página, salvo cuando la mira Axel desde el panel (?vista=panel).
 */
export function EmpezarDemo({ code, datos, contar }: { code: string; datos: Datos; contar: boolean }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!contar) return;
    try {
      navigator.sendBeacon(`/api/p/${code}`);
    } catch {
      void fetch(`/api/p/${code}`, { method: "POST", keepalive: true }).catch(() => {});
    }
  }, [code, contar]);

  async function empezar() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/iniciar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...datos, via: "navegador", ...(contar ? { ref: code } : {}) }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo abrir la demo.");
      window.location.assign(result.url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo abrir la demo.");
      setPending(false);
    }
  }

  return (
    <div className="mt-9">
      <button
        type="button"
        onClick={empezar}
        disabled={pending}
        className="rounded-xl bg-brand-600 px-8 py-4 text-base font-semibold text-white shadow-lg shadow-brand-600/20 hover:bg-brand-700 disabled:opacity-60"
      >
        {pending ? "Preparando tu demo…" : "Probar la demo"}
      </button>
      {error && (
        <p role="alert" className="mt-3 text-sm text-red-700">
          {error}
        </p>
      )}
    </div>
  );
}
