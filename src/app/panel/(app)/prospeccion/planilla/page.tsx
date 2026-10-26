import Link from "next/link";
import type { Metadata } from "next";
import { googleConfigured, redirectUri } from "@/lib/calendar/google";
import { requireAdmin } from "@/lib/panel-clinic";
import { turniaSheet } from "@/lib/sheets/turnia-sheet";
import { formatDateTime } from "@/lib/time";
import { Badge, Card, Notice, PageHeader, buttonClass, ghostButtonClass } from "@/components/ui";
import { SheetButtons } from "./buttons";

export const metadata: Metadata = { title: "Google Sheets · Prospección" };

const RESULT: Record<string, { tone: "success" | "warning" | "error"; text: string }> = {
  conectado: { tone: "success", text: "Listo: la planilla quedó conectada y con todo copiado." },
  cancelado: { tone: "warning", text: "No se conectó: se canceló en la pantalla de Google." },
  vencido: { tone: "error", text: "El pedido de conexión venció. Volvé a tocar «Conectar con Google»." },
  "sin-permiso": { tone: "error", text: "Hay que aceptar el permiso para crear y editar la planilla de Turnia. Volvé a conectar y tildalo." },
  "sin-configurar": { tone: "error", text: "Falta configurar Google en Turnia (abajo están los pasos)." },
  "sin-api": { tone: "error", text: "La cuenta quedó conectada, pero falta habilitar «Google Sheets API» en el proyecto de Google Cloud de Turnia. Habilitala y tocá «Crear la planilla»." },
  error: { tone: "error", text: "Google no respondió como esperábamos. Probá de nuevo en un momento." },
};

const STATUS = {
  conectado: { tone: "green", label: "Conectada" },
  reconectar: { tone: "red", label: "Hay que reconectar" },
  sin_planilla: { tone: "red", label: "Sin planilla" },
} as const;

export default async function PlanillaProspeccionPage({ searchParams }: PageProps<"/panel/prospeccion/planilla">) {
  await requireAdmin();
  const params = await searchParams;
  const result = typeof params.google === "string" ? RESULT[params.google] : undefined;
  const configured = googleConfigured();
  const conn = await turniaSheet();
  // Sin planilla: se borró, o no se pudo crear al conectar (por ejemplo, sin la API habilitada).
  const missing = Boolean(conn && (!conn.spreadsheet_id || conn.status === "sin_planilla"));
  const badge = conn && (missing && conn.status === "conectado" ? STATUS.sin_planilla : STATUS[conn.status]);
  const connect = (label: string) => (
    <a href="/api/google/conectar?para=planilla" className={buttonClass}>
      {label}
    </a>
  );

  return (
    <>
      <Link href="/panel/prospeccion" className={`${ghostButtonClass} -ml-3 mb-2`}>
        ← Prospección
      </Link>
      <PageHeader
        title="Google Sheets"
        description="Una planilla en tu Google Drive con la prospección y los pedidos de demo. Se actualiza sola con cada cambio: no hace falta exportar nada."
      />
      {result && <Notice tone={result.tone} className="mb-5">{result.text}</Notice>}

      <Card className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <h2 className="font-display text-xl text-brand-950">{conn ? "Tu planilla" : "Conectá tu cuenta de Google"}</h2>
          {badge && <Badge tone={badge.tone}>{badge.label}</Badge>}
        </div>

        {!configured && !conn ? (
          <Notice tone="warning" className="mt-4">
            Falta un paso de Turnia en Google, una sola vez: crear las credenciales y cargar <b>GOOGLE_CLIENT_ID</b> y <b>GOOGLE_CLIENT_SECRET</b> en
            Vercel (son las mismas de Google Calendar). La dirección de vuelta es <code className="break-all">{redirectUri()}</code>. Los pasos están en{" "}
            <code>GOOGLE_SHEETS.md</code>.
          </Notice>
        ) : !conn ? (
          <div className="mt-4 space-y-4 text-sm text-brand-900/75">
            <p className="max-w-2xl">
              Turnia crea en tu Drive la planilla «Turnia · Prospección y pedidos de demo» y la mantiene al día. Solo puede ver esa planilla: no el
              resto de tu Drive.
            </p>
            {connect("Conectar con Google")}
          </div>
        ) : (
          <div className="mt-4 space-y-4 text-sm">
            <dl className="grid gap-3 sm:grid-cols-2">
              <div>
                <dt className="text-brand-900/65">Cuenta</dt>
                <dd className="break-all font-medium text-brand-950">{conn.account_email ?? "Cuenta de Google"}</dd>
              </div>
              <div>
                <dt className="text-brand-900/65">Última copia</dt>
                <dd className="font-medium text-brand-950">{conn.last_sync_at ? formatDateTime(conn.last_sync_at) : "Todavía no"}</dd>
              </div>
            </dl>
            {conn.status === "reconectar" ? (
              <>
                <Notice tone="error">{conn.last_error ?? "Google pidió volver a conectar la cuenta."} Mientras tanto, la planilla no se actualiza.</Notice>
                {connect("Reconectar")}
              </>
            ) : (
              <>
                {missing ? (
                  <Notice tone="error">
                    {conn.last_error ?? "Todavía no hay una planilla."} {conn.spreadsheet_id ? "Creá una nueva: se copia todo de nuevo." : ""}
                  </Notice>
                ) : (
                  conn.last_error && <Notice tone="warning">{conn.last_error}</Notice>
                )}
                {conn.spreadsheet_url && !missing && (
                  <a href={conn.spreadsheet_url} target="_blank" rel="noreferrer" className={buttonClass}>
                    Abrir la planilla
                  </a>
                )}
              </>
            )}
            <SheetButtons missing={missing} first={!conn.spreadsheet_id} />
          </div>
        )}
      </Card>

      <Card>
        <h2 className="font-display text-xl text-brand-950">Qué tiene</h2>
        <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm text-brand-900/80">
          <li>
            <b>Prospección:</b> cada odontólogo con su consultorio, teléfono, estado, mensajes enviados, próximo paso, si abrió o probó su demo y el
            link de su demo.
          </li>
          <li>
            <b>Pedidos de demo:</b> los del formulario «Pedí una demo» y los de quienes probaron la demo, con su estado y tus notas.
          </li>
        </ul>
        <p className="mt-3 text-sm text-brand-900/70">
          Es un espejo de Turnia: cada copia reescribe esas dos pestañas, así que lo que escribas ahí se pisa. Para tus cuentas o filtros, agregá otra
          pestaña. Si borrás una de las dos, vuelve en la próxima copia. Tiene datos de contacto de personas: compartila solo con quien la necesita.
        </p>
      </Card>
    </>
  );
}
