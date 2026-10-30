import { getPanelClinic } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { addAppointmentType, saveAppointmentTypeWithFeedback, toggleAppointmentType } from "../../../actions";
import { EditDetails } from "../edit-details";
import { Badge, Card, Empty, Field, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import type { AppointmentType, Professional } from "@/lib/types";
import { ConfigHeader } from "../header";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Prestaciones · Panel" };

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const priceInput = (price: number | string | null) => (price ? String(Number(price)).replace(".", ",") : "");

export default async function ServicesPage() {
  const clinic = await getPanelClinic();
  const [types, professionals] = await Promise.all([
    sql<AppointmentType[]>`select * from appointment_types where clinic_id = ${clinic.id} order by active desc, specialty, name`,
    sql<Pick<Professional, "specialty" | "active">[]>`select specialty, active from professionals where clinic_id = ${clinic.id}`,
  ]);
  const specialties = [...new Set([...professionals.map((p) => p.specialty), ...types.map((x) => x.specialty)])];
  const staffed = new Set(professionals.filter((p) => p.active).map((p) => p.specialty.toLowerCase()));

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/prestaciones" />
      <p className="mb-4 max-w-3xl text-sm text-brand-900/60">Los tipos de turno que el agente puede dar. La especialidad tiene que coincidir con la de algún profesional activo.</p>
      <Card className="p-0">
        <ul className="divide-y divide-brand-900/5">
          {types.map((x) => (
            <li key={x.id} className={`px-5 py-3 ${x.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-950">{x.name} {x.is_first_visit && <Badge tone="blue">primera vez</Badge>} {x.panel_only && <Badge>solo el consultorio</Badge>} {!x.active && <Badge>Inactiva</Badge>}</p>
                  <p className="text-sm text-brand-900/65">
                    {x.specialty} · {x.duration_min} min{x.recall_months ? ` · control cada ${x.recall_months} meses` : ""}
                    {x.active && !staffed.has(x.specialty.toLowerCase()) && <span className="text-sun-700"> · sin profesional de esta especialidad</span>}
                  </p>
                </div>
                <p className="w-28 text-right text-sm font-medium text-brand-950">{x.price ? money.format(Number(x.price)) : <span className="font-normal text-brand-900/65">Sin precio</span>}</p>
                <form action={toggleAppointmentType}><input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="id" value={x.id} />
                  <input type="hidden" name="active" value={String(!x.active)} />
                  <button className={smallButtonClass}>{x.active ? "Desactivar" : "Activar"}</button>
                </form>
              </div>
              <EditDetails summary="Editar prestación" submit="Guardar prestación" action={saveAppointmentTypeWithFeedback} className="mt-3 grid gap-3 rounded-xl bg-neutral-50 p-4 sm:grid-cols-2">
                <input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="id" value={x.id} />
                  <Field label="Nombre de la prestación"><input name="name" required defaultValue={x.name} className={inputClass} /></Field>
                  <Field label="Especialidad de la prestación"><input name="specialty" required defaultValue={x.specialty} list="specialties" className={inputClass} /></Field>
                  <Field label="Duración del turno (min)"><input name="duration_min" type="number" min={5} max={480} required defaultValue={x.duration_min} className={inputClass} /></Field>
                  <Field label="Precio" hint="Referencia para el paciente y para medir campañas."><input name="price" inputMode="decimal" defaultValue={priceInput(x.price)} placeholder="45000" className={inputClass} /></Field>
                  <Field label="Control periódico (meses)" hint="Para las campañas de recall. Vacío si no aplica."><input name="recall_months" type="number" min={1} max={60} defaultValue={x.recall_months ?? ""} className={inputClass} /></Field>
                  <Field label="Indicaciones previas"><textarea name="instructions" rows={2} defaultValue={x.instructions ?? ""} className={inputClass} /></Field>
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_first_visit" defaultChecked={x.is_first_visit} /> Es primera consulta</label>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="panel_only" defaultChecked={x.panel_only} className="mt-1" /> <span>Solo la da el consultorio <span className="block text-xs text-brand-900/60">Sofi no la ofrece, no la reserva ni la mueve. El turno se da desde la Agenda.</span></span></label>
              </EditDetails>
            </li>
          ))}
        </ul>
        {!types.length && <div className="p-5"><Empty>Todavía no hay prestaciones. Agregá la primera abajo.</Empty></div>}
      </Card>

      <Card className="mt-6">
        <h2 className="mb-4 font-semibold text-brand-950">Agregar prestación</h2>
        <form action={addAppointmentType} className="grid gap-3 sm:grid-cols-2"><input type="hidden" name="clinic_id" value={clinic.id} />
          <Field label="Nombre"><input name="name" required placeholder="Control de ortodoncia" className={inputClass} /></Field>
          <Field label="Especialidad" hint="Tiene que coincidir con la del profesional."><input name="specialty" required list="specialties" className={inputClass} /></Field>
          <Field label="Duración (min)"><input name="duration_min" type="number" min={5} max={480} defaultValue={30} className={inputClass} /></Field>
          <Field label="Precio de referencia (opcional)" hint="Para estimar cuánto recuperan las campañas."><input name="price" inputMode="decimal" placeholder="45000" className={inputClass} /></Field>
          <Field label="Control periódico (meses)" hint="Para las campañas de recall. Vacío si no aplica."><input name="recall_months" type="number" min={1} max={60} className={inputClass} /></Field>
          <Field label="Indicaciones previas"><input name="instructions" className={inputClass} /></Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_first_visit" /> Es primera consulta</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="panel_only" className="mt-1" /> <span>Solo la da el consultorio <span className="block text-xs text-brand-900/60">Sofi no la ofrece, no la reserva ni la mueve. El turno se da desde la Agenda.</span></span></label>
          <div className="sm:col-span-2"><button className={buttonClass}>Agregar prestación</button></div>
        </form>
      </Card>
      <datalist id="specialties">{specialties.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
}
