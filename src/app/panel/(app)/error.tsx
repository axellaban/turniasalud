"use client";

import { Card, PageHeader, buttonClass } from "@/components/ui";

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const missingEnv = error.message.includes("variable de entorno");
  return (
    <>
      <PageHeader title="Algo no salió bien" />
      <Card>
        <p className="text-sm text-brand-900/75">
          {missingEnv
            ? error.message
            : "No pudimos cargar esta página. Revisá que la base de datos esté configurada (README → Puesta en marcha) y probá de nuevo."}
        </p>
        {error.digest && <p className="mt-2 text-xs text-brand-900/40">Código: {error.digest}</p>}
        <button onClick={reset} className={`${buttonClass} mt-4`}>
          Reintentar
        </button>
      </Card>
    </>
  );
}
