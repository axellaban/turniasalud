import Link from "next/link";
import type { Metadata } from "next";
import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import { getCatalog, isDentalClinic, rescheduleRulesText } from "@/lib/clinic";
import { DENTAL_PROTOCOL, DENTAL_PROTOCOL_VERSION, DENTAL_TEST_CASES } from "@/lib/agent/modules/odontologia";
import { Badge, Card, Field, Notice, inputClass } from "@/components/ui";
import { saveBookingRules } from "../../../protocol-actions";
import { ActionForm } from "../action-form";
import { ConfigHeader } from "../header";

export const metadata: Metadata = { title: "Turnos y urgencias · Panel" };

const wide = "sm:col-span-2";
const check = "flex items-start gap-2 text-sm";
const hint = "block text-xs text-brand-900/60";

export default async function BookingRulesPage() {
  const [clinic, user] = await Promise.all([getPanelClinic(), getPanelUser()]);
  const admin = user.role === "admin";
  const summary = rescheduleRulesText(clinic);
  const dental = isDentalClinic(clinic, await getCatalog(clinic.id));
  const active = clinic.dental_protocol && dental;

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/turnos" />
      <p className="mb-4 max-w-3xl text-sm text-brand-900/60">
        Lo que Sofi puede hacer con los turnos que ya están dados y cómo usa las horas de urgencia. Lo hacen cumplir sus herramientas: no depende de que lo lea en un texto.
      </p>
      <ActionForm action={saveBookingRules} submit="Guardar reglas" className="space-y-6">
        <input type="hidden" name="clinic_id" value={clinic.id} />
        <Card>
          <h2 className="font-semibold text-brand-950">Mover y cancelar turnos</h2>
          <p className="mt-1 text-sm text-brand-900/60">Si no se cumple una regla, Sofi no toca el turno: crea una tarea para recepción y le dice al paciente que lo conserva.</p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Aviso mínimo para mover (horas)" hint="Vacío: sin mínimo. Por ejemplo, 24.">
              <input name="reschedule_notice_hours" type="number" min={1} max={720} defaultValue={clinic.reschedule_notice_hours ?? ""} className={inputClass} />
            </Field>
            <Field label="Aviso mínimo para cancelar (horas)" hint="Vacío: Sofi cancela siempre y ofrece el lugar a la lista de espera.">
              <input name="cancel_notice_hours" type="number" min={1} max={720} defaultValue={clinic.cancel_notice_hours ?? ""} className={inputClass} />
            </Field>
            <Field label="Visita más larga que mueve Sofi (minutos)" hint="Las más largas las mueve recepción. Vacío: sin tope.">
              <input name="reschedule_max_minutes" type="number" min={15} max={600} step={5} defaultValue={clinic.reschedule_max_minutes ?? ""} className={inputClass} />
            </Field>
            <div className={wide}>
              <Field label="Turnos que mueve solo recepción" hint="Palabras separadas por coma. Cuentan en el nombre, el título o las notas del turno (también en plural). Una consulta o un control de eso sí los mueve Sofi.">
                <input name="reception_only_terms" defaultValue={clinic.reception_only_terms ?? ""} placeholder="implante, extracción, regeneración" className={inputClass} />
              </Field>
            </div>
            <label className={check}>
              <input type="checkbox" name="keep_duration_on_reschedule" defaultChecked={clinic.keep_duration_on_reschedule} className="mt-1" />
              <span>Al mover un turno, conservar su duración<span className={hint}>Si no, el turno nuevo dura lo que dice su prestación.</span></span>
            </label>
            <label className={check}>
              <input type="checkbox" name="move_panel_only" defaultChecked={clinic.move_panel_only} className="mt-1" />
              <span>Sofi mueve también lo que da solo el consultorio<span className={hint}>Si el paciente ya tiene el turno. Las reglas de arriba siguen valiendo.</span></span>
            </label>
          </div>
        </Card>

        <Card>
          <h2 className="font-semibold text-brand-950">Urgencias</h2>
          <p className="mt-1 text-sm text-brand-900/60">
            Marcá una prestación como «Es un turno de urgencia» en <Link href="/panel/configuracion/prestaciones" className="font-semibold underline">Prestaciones</Link>: con ella, Sofi busca lugar para hoy y mañana.
            Para guardar lugar, en <Link href="/panel/configuracion/equipo" className="font-semibold underline">Equipo y horarios</Link> agregá horarios «Solo urgencias»: los demás turnos no los usan.
          </p>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Field label="Liberar las horas de urgencia (horas antes)" hint="Si nadie las usó, a partir de cuántas horas antes Sofi las ofrece para cualquier turno. Vacío: nunca.">
              <input name="urgent_release_hours" type="number" min={1} max={72} defaultValue={clinic.urgent_release_hours ?? ""} className={inputClass} />
            </Field>
          </div>
        </Card>

        {admin && (
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold text-brand-950">Protocolo odontológico de Turnia</h2>
              <Badge tone={active ? "green" : "gray"}>{active ? "Prendido" : "Apagado"}</Badge>
              <Badge>Solo Turnia</Badge>
            </div>
            <p className="mt-1 text-sm text-brand-900/60">
              Lo común a todos los consultorios odontológicos: qué es urgente, qué turno corresponde a cada pedido y qué tratamientos empiezan con una consulta. Las instrucciones propias de la clínica mandan sobre él.
            </p>
            <Notice tone="info" className="mt-3">
              Versión {DENTAL_PROTOCOL_VERSION}. Va prendido en todos los consultorios odontológicos. Después de cada cambio, probá los casos de abajo en <Link href="/panel/probar" className="font-semibold underline">Probar a {clinic.agent_name || "Sofi"}</Link>; conviene repasar los criterios con un odontólogo.
            </Notice>
            {!dental && <p className="mt-3 text-sm text-sun-700">Esta clínica no es odontológica (ni su especialidad ni la de sus profesionales): el protocolo no se usa acá.</p>}
            <input type="hidden" name="dental_protocol_field" value="1" />
            <label className={`${check} mt-4`}>
              <input type="checkbox" name="dental_protocol" defaultChecked={clinic.dental_protocol} className="mt-1" />
              <span>Usar el protocolo odontológico en esta clínica</span>
            </label>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">Ver el texto que recibe Sofi</summary>
              <pre className="mt-2 whitespace-pre-wrap rounded-xl bg-neutral-50 p-4 font-sans text-sm text-brand-900/80">{DENTAL_PROTOCOL}</pre>
            </details>
            <details className="mt-3">
              <summary className="cursor-pointer text-sm font-medium text-brand-700">Casos para probar ({DENTAL_TEST_CASES.length})</summary>
              <ol className="mt-2 list-decimal space-y-1.5 pl-5 text-sm text-brand-900/80">
                {DENTAL_TEST_CASES.map((c) => (
                  <li key={c.message}><span className="font-medium text-brand-950">«{c.message}»</span> → {c.expected}</li>
                ))}
              </ol>
            </details>
          </Card>
        )}
      </ActionForm>

      <Card className="mt-6">
        <h2 className="font-semibold text-brand-950">Lo que sabe Sofi de estas reglas</h2>
        {summary ? (
          <pre className="mt-2 whitespace-pre-wrap font-sans text-sm text-brand-900/80">{summary}</pre>
        ) : (
          <p className="mt-2 text-sm text-brand-900/60">Sin reglas cargadas: Sofi mueve y cancela cualquier turno que no sea «Solo la da el consultorio».</p>
        )}
      </Card>
    </>
  );
}
