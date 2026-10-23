"use client";

import { Card, PageHeader, buttonClass } from "@/components/ui";

/** Una pestaña abierta antes de un deploy llama a acciones que la versión nueva ya no tiene. */
const isStaleVersion = (error: Error) => error.name === "UnrecognizedActionError" || /was not found on the server|failed-to-find-server-action/i.test(error.message);

export default function PanelError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  if (isStaleVersion(error)) {
    return (
      <>
        <PageHeader title="Hay una versión nueva del panel" />
        <Card>
          <p className="text-sm text-brand-900/75">
            Se publicó una actualización mientras tenías esta página abierta, y la acción no se pudo completar. Recargá la página para seguir.
            Si estabas editando las reglas del consultorio, al volver vas a poder recuperar lo que escribiste.
          </p>
          <button onClick={() => window.location.reload()} className={`${buttonClass} mt-4`}>
            Recargar
          </button>
        </Card>
      </>
    );
  }
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
