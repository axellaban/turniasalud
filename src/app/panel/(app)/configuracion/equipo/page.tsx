import { getPanelClinic } from "@/lib/panel-clinic";
import { getCatalog } from "@/lib/clinic";
import { sql } from "@/lib/db";
import { addProfessional, addSchedule, deleteSchedule, saveProfessional, toggleProfessional } from "../../../actions";
import { Badge, Card, Empty, Field, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import type { AppointmentType, Professional } from "@/lib/types";
import { ConfigHeader, WEEKDAYS } from "../header";

/** La semana empieza el lunes. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export default async function TeamPage() {
  const clinic = await getPanelClinic();
  const [professionals, types, catalog] = await Promise.all([
    sql<Professional[]>`select * from professionals where clinic_id = ${clinic.id} order by active desc, full_name`,
    sql<Pick<AppointmentType, "specialty">[]>`select specialty from appointment_types where clinic_id = ${clinic.id}`,
    getCatalog(clinic.id),
  ]);
  const specialties = [...new Set([...professionals.map((p) => p.specialty), ...types.map((x) => x.specialty)])];

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/equipo" />
      <p className="mb-4 max-w-3xl text-sm text-brand-900/60">El agente solo ofrece turnos dentro de estos horarios. Para feriados o vacaciones usá «Feriados y bloqueos».</p>
      <div className="space-y-4">
        {professionals.map((p) => {
          const ranges = catalog.schedules.filter((s) => s.professional_id === p.id);
          return (
            <Card key={p.id} className={p.active ? "" : "opacity-70"}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold text-brand-950">{p.full_name} {!p.active && <Badge>Inactivo</Badge>}</h2>
                  <p className="text-sm text-brand-900/60">{p.specialty}{p.accepted_coverages?.length ? ` · Solo: ${p.accepted_coverages.join(", ")}` : ""}</p>
                </div>
                <form action={toggleProfessional}><input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="id" value={p.id} />
                  <input type="hidden" name="active" value={String(!p.active)} />
                  <button className={smallButtonClass}>{p.active ? "Desactivar" : "Activar"}</button>
                </form>
              </div>

              {p.active && <>
                <div className="mt-4 grid gap-1.5 sm:grid-cols-7 sm:gap-2">
                  {WEEK.map((day) => {
                    const list = ranges.filter((s) => s.weekday === day).sort((a, b) => a.start_time.localeCompare(b.start_time));
                    return (
                      <div key={day} className="flex items-start gap-2 rounded-xl bg-neutral-50 px-3 py-2 sm:block sm:min-h-20 sm:px-2">
                        <p className="w-10 shrink-0 pt-1 text-xs font-semibold uppercase text-brand-900/50 sm:w-auto sm:pt-0">{WEEKDAYS[day]}</p>
                        <div className="flex flex-1 flex-wrap gap-1 sm:mt-1.5 sm:flex-col">
                          {list.map((s) => (
                            <form key={s.id} action={deleteSchedule} className="inline-flex items-center justify-between gap-1 rounded-lg bg-brand-50 px-2 py-1 text-xs font-medium text-brand-800">
                              <input type="hidden" name="clinic_id" value={clinic.id} />
                              <input type="hidden" name="id" value={s.id} />
                              {s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}
                              <button title="Quitar este horario" aria-label={`Quitar ${WEEKDAYS[day]} ${s.start_time.slice(0, 5)}`} className="px-0.5 text-brand-900/40 hover:text-red-600">×</button>
                            </form>
                          ))}
                          {!list.length && <span className="pt-1 text-xs text-brand-900/30 sm:pt-0">—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!ranges.length && <p className="mt-2 text-sm text-sun-600">Sin horarios: el agente no va a ofrecer turnos con este profesional.</p>}

                <form action={addSchedule} className="mt-3 flex flex-wrap items-end gap-3 rounded-xl border border-dashed border-brand-900/15 p-3">
                  <input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="professional_id" value={p.id} />
                  <fieldset>
                    <legend className="mb-1 text-xs font-medium text-brand-900/60">Días</legend>
                    <div className="flex flex-wrap gap-1">
                      {WEEK.map((day) => (
                        <label key={day} className="cursor-pointer">
                          <input type="checkbox" name="weekday" value={day} className="peer sr-only" />
                          <span className="inline-block rounded-lg px-2.5 py-1.5 text-xs font-medium text-brand-900/70 ring-1 ring-brand-900/15 peer-checked:bg-brand-600 peer-checked:text-white peer-checked:ring-brand-600 peer-focus-visible:ring-2 peer-focus-visible:ring-brand-400">{WEEKDAYS[day]}</span>
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <label className="text-xs font-medium text-brand-900/60">Desde<input type="time" name="start_time" required className="mt-1 block rounded-lg border border-brand-900/15 px-2 py-1.5 text-sm" /></label>
                  <label className="text-xs font-medium text-brand-900/60">Hasta<input type="time" name="end_time" required className="mt-1 block rounded-lg border border-brand-900/15 px-2 py-1.5 text-sm" /></label>
                  <button className={smallButtonClass}>+ Agregar horario</button>
                </form>
              </>}

              <details className="mt-3"><summary className="cursor-pointer text-sm font-medium text-brand-700">Editar profesional</summary>
                <form action={saveProfessional} className="mt-3 grid gap-3 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="id" value={p.id} />
                  <Field label="Nombre del profesional"><input name="full_name" required defaultValue={p.full_name} className={inputClass} /></Field>
                  <Field label="Especialidad del profesional"><input name="specialty" required defaultValue={p.specialty} list="specialties" className={inputClass} /></Field>
                  <Field label="Coberturas del profesional" hint="Solo si atiende algunas. Separadas por coma."><input name="accepted_coverages" defaultValue={p.accepted_coverages?.join(", ") ?? ""} className={inputClass} /></Field>
                  <Field label="Descripción del profesional"><input name="bio" defaultValue={p.bio ?? ""} className={inputClass} /></Field>
                  <div className="sm:col-span-2"><button className={buttonClass}>Guardar profesional</button></div>
                </form>
              </details>
            </Card>
          );
        })}
        {!professionals.length && <Empty>Todavía no hay profesionales. Agregá el primero abajo.</Empty>}

        <Card>
          <h2 className="mb-4 font-semibold text-brand-950">Agregar profesional</h2>
          <form action={addProfessional} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
            <Field label="Nombre"><input name="full_name" required placeholder="Dra. Ana López" className={inputClass} /></Field>
            <Field label="Especialidad" hint="Tiene que coincidir con la de sus prestaciones."><input name="specialty" required list="specialties" placeholder="Dermatología" className={inputClass} /></Field>
            <Field label="Coberturas (opcional)" hint="Solo si atiende algunas. Separadas por coma."><input name="accepted_coverages" className={inputClass} /></Field>
            <Field label="Descripción breve"><input name="bio" className={inputClass} /></Field>
            <div className="sm:col-span-2"><button className={buttonClass}>Agregar profesional</button></div>
          </form>
        </Card>
      </div>
      <datalist id="specialties">{specialties.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
}
