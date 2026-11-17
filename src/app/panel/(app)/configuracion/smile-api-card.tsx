import { sql } from "@/lib/db";
import { READ_CAP, SMILE_MODE_LABEL, SMILE_MODES, WRITE_MODES, getSmileApiConnection, writesEnabledOnServer } from "@/lib/smile-connect-link";
import { recentSmileChanges, smileReviewList } from "@/lib/smile-connect-push";
import { formatDateTime } from "@/lib/time";
import type { Clinic } from "@/lib/types";
import { Badge, Card, Field, Notice, inputClass, smallButtonClass } from "@/components/ui";
import { dismissSmileReviewAction, removeSmileApiKeyAction, resumeSmileWritesAction, saveSmileApiKeyAction, setSmileModeAction, syncSmileNowAction } from "../../smile-api-actions";
import { ActionForm } from "./action-form";

const ACTION: Record<string, string> = { crear_paciente: "Crear paciente", crear: "Crear turno", mover: "Mover turno", cancelar: "Cancelar turno" };
const STATUS: Record<string, { label: string; tone: "green" | "yellow" | "red" | "gray" | "blue" }> = {
  hecho: { label: "Hecho", tone: "green" },
  sombra: { label: "Prueba (no se escribió)", tone: "blue" },
  revisar: { label: "Revisar", tone: "yellow" },
  error: { label: "Error", tone: "red" },
};

/**
 * Configuración → Calendario: la conexión con la API pública de Smile Connect (clave, modo, estado,
 * lo que hay que revisar y el registro de cada cambio). La clave y el modo los cambia solo Turnia.
 */
export async function loadSmileApiCard(clinicId: string) {
  const conn = await getSmileApiConnection(clinicId);
  const hasKey = Boolean(conn?.api_key_encrypted);
  const [pros, changes, review] = await Promise.all([
    sql<Array<{ full_name: string; smile_professional_id: number | null; smile_box_id: number | null; active: boolean }>>`
      select full_name, smile_professional_id, smile_box_id, active from professionals where clinic_id = ${clinicId} order by active desc, full_name`,
    hasKey ? recentSmileChanges(clinicId) : [],
    hasKey ? smileReviewList(clinicId) : [],
  ]);
  return { conn, pros: [...pros], changes, review };
}

export function SmileApiCard({ clinic, admin, data: { conn, pros, changes, review } }: { clinic: Clinic; admin: boolean; data: Awaited<ReturnType<typeof loadSmileApiCard>> }) {
  const hasKey = Boolean(conn?.api_key_encrypted);
  const mode = conn?.api_mode ?? "apagada";
  const when = (iso: string | null | undefined) => (iso ? formatDateTime(iso, clinic.timezone) : "todavía no");
  const tz = clinic.timezone;
  const readsToday = conn?.api_reads_day === new Date().toISOString().slice(0, 10) ? conn.api_reads : 0;

  if (!admin && !hasKey) return null;
  return (
    <Card id="smile-connect-api" className="mt-6 scroll-mt-20">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-brand-950">Smile Connect por API</h2>
        <Badge tone={mode === "apagada" ? "gray" : WRITE_MODES.includes(mode) ? "yellow" : "green"}>{SMILE_MODE_LABEL[mode].label}</Badge>
      </div>
      <p className="mt-1 max-w-3xl text-sm text-brand-900/60">
        Con la clave de la API de Smile Connect, Turnia trae la agenda sin Tampermonkey y Sofi ofrece solo lo que está libre ahí, con bloqueos y
        feriados. En modo «Crear turnos», Sofi confirma cada alta simple después de comprobarla en Smile Connect.
      </p>

      {hasKey && !conn?.api_supports_notes && <Notice tone="warning" className="mt-3">
        La API de Smile Connect todavía no acepta el motivo del turno: lo que escriba Turnia llega allá sin prestación ni motivo. Cuando lo
        acepte, Turnia lo empieza a mandar solo (lo revisa todos los días).
      </Notice>}
      {(mode === "crear" || mode === "completa") && !writesEnabledOnServer() && <Notice tone="info" className="mt-3">
        La escritura real está deshabilitada en el servidor (falta <code>SMILE_CONNECT_WRITES=on</code>): por ahora funciona como prueba y no escribe nada.
      </Notice>}
      {conn?.api_writes_paused && <Notice tone="error" className="mt-3">
        {conn.api_writes_paused}
        {admin && <form action={resumeSmileWritesAction} className="mt-2">
          <input type="hidden" name="clinic_id" value={clinic.id} />
          <button className={smallButtonClass}>Reanudar la escritura</button>
        </form>}
      </Notice>}
      {conn?.api_error && <Notice tone="error" className="mt-3">Último problema ({when(conn.api_error_at)}): {conn.api_error}</Notice>}

      <div className="mt-4 grid gap-6 lg:grid-cols-2">
        <div className="space-y-4">
          {hasKey && <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
            <dt className="text-brand-900/60">Clínica en Smile Connect</dt><dd className="text-brand-950">{conn?.api_clinic_name ?? "Sin nombre"} (#{conn?.api_clinic_id})</dd>
            <dt className="text-brand-900/60">Clave</dt><dd className="text-brand-950">…{conn?.api_key_hint} · probada {when(conn?.api_checked_at)}</dd>
            <dt className="text-brand-900/60">Agenda cercana</dt><dd className="text-brand-950">{when(conn?.api_near_pull_at)}</dd>
            <dt className="text-brand-900/60">Agenda lejana</dt><dd className="text-brand-950">{when(conn?.api_wide_pull_at)}</dd>
            <dt className="text-brand-900/60">Copia diaria</dt><dd className="text-brand-950">{when(conn?.api_backup_at)}</dd>
            <dt className="text-brand-900/60">Lecturas de hoy</dt><dd className="text-brand-950">{readsToday.toLocaleString("es-AR")} de {READ_CAP.toLocaleString("es-AR")}</dd>
          </dl>}

          {admin && <ActionForm action={saveSmileApiKeyAction} submit={hasKey ? "Cambiar la clave" : "Probar y guardar la clave"} resetOnSuccess secondary className="grid gap-3">
            <input type="hidden" name="clinic_id" value={clinic.id} />
            <Field label="Clave de la API" hint="La crea el consultorio en Smile Connect («API pública»). Mejor sin vencimiento: por defecto vence a los 30 días. Permisos de lectura de clínica, profesionales, consultorios, disponibilidad, turnos y pacientes; para escribir, además crear pacientes y crear, mover y cancelar turnos.">
              <input name="api_key" type="password" autoComplete="off" required placeholder="sc_live_…" className={inputClass} />
            </Field>
          </ActionForm>}

          {hasKey && <ActionForm action={syncSmileNowAction} submit="Sincronizar ahora" secondary>
            <input type="hidden" name="clinic_id" value={clinic.id} />
          </ActionForm>}

          {admin && hasKey && <form action={removeSmileApiKeyAction}>
            <input type="hidden" name="clinic_id" value={clinic.id} />
            <button className={smallButtonClass}>Quitar la clave y apagar</button>
          </form>}
        </div>

        <div className="space-y-4">
          {admin && hasKey && <ActionForm action={setSmileModeAction} submit="Guardar el modo" secondary className="grid gap-2">
            <input type="hidden" name="clinic_id" value={clinic.id} />
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium text-brand-950">Qué hace</legend>
              {SMILE_MODES.map((m) => <label key={m} className="flex gap-2 text-sm">
                <input type="radio" name="mode" value={m} defaultChecked={m === mode} className="mt-1" />
                <span><span className="font-medium text-brand-950">{SMILE_MODE_LABEL[m].label}.</span> <span className="text-brand-900/70">{SMILE_MODE_LABEL[m].detail}</span></span>
              </label>)}
            </fieldset>
            <label className="flex gap-2 text-xs text-brand-900/80">
              <input type="checkbox" name="confirm" className="mt-0.5" />
              Para crear, mover o cancelar en Smile Connect: lo revisé con el consultorio y probamos el modo de prueba.
            </label>
          </ActionForm>}

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-900/60">Profesionales</h3>
            <ul className="mt-1 space-y-0.5 text-sm">
              {pros.map((p) => <li key={p.full_name} className="flex flex-wrap gap-2">
                <span className={p.active ? "text-brand-950" : "text-brand-900/50"}>{p.full_name}</span>
                <span className="text-brand-900/60">{p.smile_professional_id ? `→ Smile Connect #${p.smile_professional_id}${p.smile_box_id ? `, consultorio #${p.smile_box_id}` : ""}` : "· sin vincular"}</span>
              </li>)}
            </ul>
          </div>
        </div>
      </div>

      {review.length > 0 && <div className="mt-5 border-t border-brand-900/5 pt-4">
        <h3 className="text-sm font-semibold text-brand-950">Para revisar en Smile Connect</h3>
        <ul className="mt-2 divide-y divide-brand-900/5 text-sm">
          {review.map((r) => <li key={r.id} className="flex flex-wrap items-start justify-between gap-2 py-2">
            <span className="min-w-0"><span className="font-medium text-brand-950">{r.patient ?? "Paciente"}</span> · {formatDateTime(r.starts_at, tz)}
              <span className="block text-brand-900/70">{r.smile_error}</span></span>
            {r.status === "pendiente" ? <span className="text-xs text-brand-900/70">Verificá el pedido en Smile Connect antes de confirmar.</span> : <form action={dismissSmileReviewAction}>
              <input type="hidden" name="clinic_id" value={clinic.id} /><input type="hidden" name="id" value={r.id} />
              <button className={smallButtonClass}>Ya lo resolví</button>
            </form>}
          </li>)}
        </ul>
      </div>}

      {changes.length > 0 && <div className="mt-5 border-t border-brand-900/5 pt-4">
        <h3 className="text-sm font-semibold text-brand-950">Registro de cambios en Smile Connect</h3>
        <p className="text-xs text-brand-900/60">Cada uno guarda cómo estaba antes, para poder deshacerlo a mano.</p>
        <ul className="mt-2 space-y-2 text-xs">
          {changes.map((c) => <li key={c.id} className="rounded-xl border border-brand-900/10 p-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={STATUS[c.status]?.tone ?? "gray"}>{STATUS[c.status]?.label ?? c.status}</Badge>
              <span className="font-medium text-brand-950">{ACTION[c.action] ?? c.action}</span>
              <span className="text-brand-900/60">{formatDateTime(c.created_at, tz)}</span>
            </div>
            {c.error && <p className="mt-1 text-red-700">{c.error}</p>}
            {(c.request != null || c.before != null) && <details className="mt-1">
              <summary className="cursor-pointer text-brand-700">Detalle</summary>
              {c.before != null && <><p className="mt-1 font-medium">Cómo estaba en Smile Connect:</p><pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(c.before, null, 1)}</pre></>}
              {c.request != null && <><p className="mt-1 font-medium">Lo que se mandó:</p><pre className="overflow-x-auto whitespace-pre-wrap break-all">{JSON.stringify(c.request, null, 1)}</pre></>}
            </details>}
          </li>)}
        </ul>
      </div>}
    </Card>
  );
}
