import Link from "next/link";
import { getPanelClinic } from "@/lib/panel-clinic";
import { getCatalog } from "@/lib/clinic";
import { sql } from "@/lib/db";
import { addProfessional, addSchedule, deleteSchedule, saveProfessionalWithFeedback, toggleProfessional } from "../../../actions";
import { EditDetails } from "../edit-details";
import { Badge, Card, Empty, Field, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import type { AppointmentType, Professional } from "@/lib/types";
import { ConfigHeader, WEEKDAYS } from "../header";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Equipo y horarios · Panel" };

/** La semana empieza el lunes. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

export default async function TeamPage() {
  const clinic = await getPanelClinic();
  const [professionals, types, catalog] = await Promise.all([
    sql<Professional[]>`select * from professionals where clinic_id = ${clinic.id} order by active desc, full_name`,
    sql<Pick<AppointmentType, "id" | "name" | "specialty" | "active">[]>`select id, name, specialty, active from appointment_types where clinic_id = ${clinic.id} order by name`,
    getCatalog(clinic.id),
  ]);
  const specialties = [...new Set([...professionals.map((p) => p.specialty), ...types.map((x) => x.specialty)])];
  const activeTypes = types.filter((t) => t.active);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const linksOf = (id: string) => (catalog.links ?? []).filter((l) => l.professional_id === id).map((l) => l.appointment_type_id);

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/equipo" />
      <p className="mb-4 max-w-3xl text-sm text-brand-900/60">{clinic.agent_name || "Sofi"} solo ofrece turnos dentro de estos horarios. Para feriados o vacaciones usá «Feriados y bloqueos».</p>
      <div className="space-y-4">
        {professionals.map((p) => {
          const ranges = catalog.schedules.filter((s) => s.professional_id === p.id);
          const own = linksOf(p.id);
          return (
            <Card key={p.id} className={p.active ? "" : "opacity-70"}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="font-semibold text-brand-950">{p.full_name} {!p.active && <Badge>Inactivo</Badge>}</h2>
                  <p className="text-sm text-brand-900/60">{p.specialty} · {own.length ? `hace ${own.map((id) => typeName.get(id)).filter(Boolean).join(", ")}` : "hace todas las prestaciones de su especialidad"}</p>
                  {p.accepted_coverages?.length ? (
                    <p className="text-sm text-brand-900/60">Solo atiende por {p.accepted_coverages.join(", ")} · <Link href="/panel/configuracion/coberturas#profesionales" className="font-medium text-brand-700 hover:underline">cambiar</Link></p>
                  ) : null}
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
                        <p className="w-10 shrink-0 pt-1 text-xs font-semibold uppercase text-brand-900/65 sm:w-auto sm:pt-0">{WEEKDAYS[day]}</p>
                        <div className="flex flex-1 flex-wrap gap-1 sm:mt-1.5 sm:flex-col">
                          {list.map((s) => {
                            const only = (s.appointment_type_ids ?? []).map((id) => typeName.get(id)).filter(Boolean);
                            const note = [s.urgent_only && "Solo urgencias", only.length && `Solo ${only.join(", ")}`].filter(Boolean).join(" · ");
                            return (
                            <form key={s.id} action={deleteSchedule} title={note || undefined} className={`inline-flex items-center justify-between gap-1 rounded-lg px-2 py-1 text-xs font-medium ${s.urgent_only ? "bg-red-50 text-red-800" : "bg-brand-50 text-brand-800"}`}>
                              <input type="hidden" name="clinic_id" value={clinic.id} />
                              <input type="hidden" name="id" value={s.id} />
                              <span>{s.start_time.slice(0, 5)}–{s.end_time.slice(0, 5)}{note && <span className="block font-normal opacity-80">{s.urgent_only ? "urgencias" : ""}{s.urgent_only && only.length ? " · " : ""}{only.length ? `solo ${only.length === 1 ? only[0] : `${only.length} prestaciones`}` : ""}</span>}</span>
                              <button title="Quitar este horario" aria-label={`Quitar ${WEEKDAYS[day]} ${s.start_time.slice(0, 5)}`} className="px-0.5 text-brand-900/65 hover:text-red-600">×</button>
                            </form>
                            );
                          })}
                          {!list.length && <span className="pt-1 text-xs text-brand-900/65 sm:pt-0">—</span>}
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!ranges.length && <p className="mt-2 text-sm text-sun-700">Sin horarios: {clinic.agent_name || "Sofi"} no va a ofrecer turnos con este profesional.</p>}

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
                  <label className="flex items-center gap-1.5 self-center text-xs font-medium text-brand-900/70" title="Solo los usan los turnos de urgencia (y el consultorio desde la Agenda).">
                    <input type="checkbox" name="urgent_only" /> Solo urgencias
                  </label>
                  {activeTypes.length > 1 && (
                    <details className="basis-full text-xs">
                      <summary className="cursor-pointer font-medium text-brand-700">Solo para algunas prestaciones (opcional)</summary>
                      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1.5">
                        {activeTypes.map((t) => (
                          <label key={t.id} className="flex items-center gap-1.5 text-brand-900/80">
                            <input type="checkbox" name="appointment_type_ids" value={t.id} /> {t.name}
                          </label>
                        ))}
                      </div>
                    </details>
                  )}
                  <button className={smallButtonClass}>+ Agregar horario</button>
                </form>
              </>}

              <div className="mt-3"><EditDetails summary="Editar profesional" submit="Guardar profesional" action={saveProfessionalWithFeedback} className="mt-3 grid gap-3 sm:grid-cols-2">
                <input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="id" value={p.id} />
                  <Field label="Nombre del profesional"><input name="full_name" required defaultValue={p.full_name} className={inputClass} /></Field>
                  <Field label="Especialidad del profesional"><input name="specialty" required defaultValue={p.specialty} list="specialties" className={inputClass} /></Field>
                  <Field label="Descripción del profesional"><input name="bio" defaultValue={p.bio ?? ""} className={inputClass} /></Field>
                  {activeTypes.length > 0 && (
                    <fieldset className="sm:col-span-2">
                      <input type="hidden" name="types_field" value="1" />
                      <legend className="text-sm font-medium text-brand-950">Qué prestaciones hace</legend>
                      <p className="text-xs text-brand-900/60">Si no marcás ninguna, hace todas las de su especialidad ({p.specialty}).</p>
                      <div className="mt-2 grid gap-1.5 sm:grid-cols-2">
                        {activeTypes.map((t) => (
                          <label key={t.id} className="flex items-center gap-2 text-sm">
                            <input type="checkbox" name="appointment_type_ids" value={t.id} defaultChecked={own.includes(t.id)} /> {t.name}
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  )}
              </EditDetails></div>
            </Card>
          );
        })}
        {!professionals.length && <Empty>Todavía no hay profesionales. Agregá el primero abajo.</Empty>}

        <Card>
          <h2 className="mb-4 font-semibold text-brand-950">Agregar profesional</h2>
          <form action={addProfessional} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
            <Field label="Nombre"><input name="full_name" required placeholder="Dra. Ana López" className={inputClass} /></Field>
            <Field label="Especialidad" hint="Hace las prestaciones de su especialidad, salvo que marques otras al editarlo."><input name="specialty" required list="specialties" placeholder="Odontología" className={inputClass} /></Field>
            <Field label="Descripción breve"><input name="bio" className={inputClass} /></Field>
            <div className="sm:col-span-2"><button className={buttonClass}>Agregar profesional</button></div>
          </form>
        </Card>
      </div>
      <datalist id="specialties">{specialties.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
}
