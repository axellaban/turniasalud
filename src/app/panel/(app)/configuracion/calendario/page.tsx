import type { Metadata } from "next";
import { sql } from "@/lib/db";
import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { getConnection, googleConfigured, listCalendars, redirectUri, type GoogleCalendar } from "@/lib/calendar/google";
import { formatDateTime } from "@/lib/time";
import { Badge, Card, Empty, Notice, buttonClass, secondaryButtonClass } from "@/components/ui";
import { disconnectCalendar, syncCalendarNow } from "../../../calendar-actions";
import { ProfessionalCalendarForm } from "../calendario-form";
import { ConfigHeader } from "../header";

export const metadata: Metadata = { title: "Calendario · Panel" };

const RESULT: Record<string, { tone: "success" | "warning" | "error"; text: string }> = {
  conectado: { tone: "success", text: "Google Calendar quedó conectado. Ahora elegí el calendario de cada profesional." },
  cancelado: { tone: "warning", text: "No se conectó: se canceló en la pantalla de Google." },
  vencido: { tone: "error", text: "El pedido de conexión venció o no era de esta clínica. Volvé a tocar «Conectar Google Calendar»." },
  "sin-permiso": { tone: "error", text: "Hay que aceptar el permiso para ver y editar eventos del calendario. Volvé a conectar y tildalo." },
  "sin-configurar": { tone: "error", text: "Falta configurar Google en Turnia (GOOGLE_CLIENT_ID y GOOGLE_CLIENT_SECRET)." },
  "clinica-cambiada": { tone: "error", text: "La clínica seleccionada cambió. Recargá la pantalla y volvé a conectar." },
  error: { tone: "error", text: "Google no respondió como esperábamos. Probá de nuevo en un momento." },
};

type Pro = { id: string; full_name: string; specialty: string; active: boolean; google_calendar_id: string | null; google_calendar_name: string | null };

export default async function CalendarPage({ searchParams }: PageProps<"/panel/configuracion/calendario">) {
  const [clinic, user, params] = await Promise.all([getPanelClinic(), getPanelUser(), searchParams]);
  const result = typeof params.google === "string" ? RESULT[params.google] : undefined;
  const configured = googleConfigured();
  const conn = configured ? await getConnection(clinic.id) : null;
  const [professionals, [counts]] = await Promise.all([
    sql<Pro[]>`select id, full_name, specialty, active, google_calendar_id, google_calendar_name from professionals where clinic_id = ${clinic.id} order by active desc, full_name`,
    sql<{ pendientes: number; errores: number; sincronizados: number }[]>`
      select count(*) filter (where calendar_sync = 'pendiente')::int as pendientes,
             count(*) filter (where calendar_sync = 'error')::int as errores,
             count(*) filter (where calendar_sync = 'ok' and calendar_event_id is not null and ends_at > now())::int as sincronizados
      from appointments where clinic_id = ${clinic.id}`,
  ]);
  let calendars: GoogleCalendar[] | null = null;
  if (conn && conn.status === "conectado") calendars = await listCalendars(conn).catch(() => null);

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/calendario" />
      {result && <Notice tone={result.tone} className="mb-5">{result.text}</Notice>}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold text-brand-950">Google Calendar</h2>
              <p className="mt-1 text-sm text-brand-900/65">
                Lo ocupado en el calendario de cada profesional deja de ofrecerse, y cada turno que da Turnia aparece en su calendario.
              </p>
            </div>
            {conn && <Badge tone={conn.status === "conectado" ? "green" : "red"}>{conn.status === "conectado" ? "Conectado" : "Hay que reconectar"}</Badge>}
          </div>

          {!configured ? (
            <div className="mt-5">
              <Notice tone="warning">
                {user.role === "admin"
                  ? <>Falta crear las credenciales de Google y cargar <b>GOOGLE_CLIENT_ID</b> y <b>GOOGLE_CLIENT_SECRET</b> en Vercel. La dirección de vuelta es <code className="break-all">{redirectUri()}</code>. Los pasos están en <code>GOOGLE_CALENDAR.md</code>.</>
                  : "La conexión con Google Calendar todavía no está habilitada. Pedíselo a Turnia."}
              </Notice>
            </div>
          ) : !conn ? (
            <div className="mt-5 space-y-4 text-sm text-brand-900/75">
              <ol className="list-decimal space-y-1.5 pl-5">
                <li>Conectá la cuenta de Google de la clínica (la que comparte los calendarios de los profesionales).</li>
                <li>Elegí, para cada profesional, cuál es su calendario.</li>
                <li>Listo: Turnia mira lo ocupado y anota cada turno nuevo.</li>
              </ol>
              <a href={`/api/google/conectar?clinic_id=${clinic.id}`} className={buttonClass}>Conectar Google Calendar</a>
              <p className="text-xs text-brand-900/65">En el calendario solo se anotan la prestación, el nombre corto del paciente y su teléfono. Nunca DNI, cobertura ni notas.</p>
            </div>
          ) : (
            <div className="mt-5 space-y-4 text-sm">
              <dl className="grid gap-3 sm:grid-cols-2">
                <div><dt className="text-brand-900/65">Cuenta</dt><dd className="break-all font-medium text-brand-950">{conn.account_email ?? "Cuenta de Google"}</dd></div>
                <div><dt className="text-brand-900/65">Última lectura</dt><dd className="font-medium text-brand-950">{conn.last_sync_at ? formatDateTime(conn.last_sync_at, clinic.timezone) : "Todavía no"}</dd></div>
                <div><dt className="text-brand-900/65">Turnos próximos en Google</dt><dd className="font-medium text-brand-950">{counts.sincronizados}</dd></div>
                <div><dt className="text-brand-900/65">Por escribir</dt><dd className="font-medium text-brand-950">{counts.pendientes + counts.errores}{counts.errores ? ` (${counts.errores} con error)` : ""}</dd></div>
              </dl>
              {conn.status === "error" && (
                <Notice tone="error">{conn.last_error ?? "Google pidió volver a conectar."} Mientras tanto los turnos se siguen dando y quedan guardados para escribirse al reconectar.</Notice>
              )}
              <div className="flex flex-wrap gap-3">
                {conn.status === "error" ? (
                  <a href={`/api/google/conectar?clinic_id=${clinic.id}`} className={buttonClass}>Reconectar</a>
                ) : (
                  <form action={syncCalendarNow}>
                    <input type="hidden" name="clinic_id" value={clinic.id} />
                    <button className={secondaryButtonClass}>Sincronizar ahora</button>
                  </form>
                )}
                <form action={disconnectCalendar}>
                  <input type="hidden" name="clinic_id" value={clinic.id} />
                  <button className={secondaryButtonClass}>Desconectar</button>
                </form>
              </div>
              <p className="text-xs text-brand-900/65">Al desconectar, los eventos que ya están en Google quedan donde están.</p>
            </div>
          )}
        </Card>

        <Card>
          <h2 className="font-semibold text-brand-950">Calendario de cada profesional</h2>
          <p className="mt-1 text-sm text-brand-900/65">
            Turnia lee los horarios ocupados (no los títulos) y escribe sus turnos. Los eventos marcados como «Disponible» no bloquean la agenda.
          </p>
          {!conn ? (
            <div className="mt-4"><Empty>Conectá Google Calendar para elegir los calendarios.</Empty></div>
          ) : !calendars ? (
            <div className="mt-4"><Notice tone="warning">No se pudo leer la lista de calendarios de Google. {conn.status === "error" ? "Reconectá la cuenta." : "Probá recargar en un momento."}</Notice></div>
          ) : !professionals.length ? (
            <div className="mt-4"><Empty>Todavía no hay profesionales cargados.</Empty></div>
          ) : (
            <ul className="mt-4 divide-y divide-brand-900/10">
              {professionals.map((p) => (
                <li key={p.id} className="py-4 first:pt-0 last:pb-0">
                  <p className="font-medium text-brand-950">
                    {p.full_name}
                    {!p.active && <span className="ml-2 text-xs font-normal text-brand-900/65">(inactivo)</span>}
                  </p>
                  <p className="mb-2 text-xs text-brand-900/65">{p.specialty}{p.google_calendar_name ? ` · Ahora: ${p.google_calendar_name}` : ""}</p>
                  <ProfessionalCalendarForm clinicId={clinic.id} professionalId={p.id} current={p.google_calendar_id} calendars={calendars} />
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </>
  );
}
