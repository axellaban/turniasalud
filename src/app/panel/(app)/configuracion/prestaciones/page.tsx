import { getPanelClinic } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { agentCanMove, professionalDoes } from "@/lib/booking-rules";
import { isDentalSpecialty } from "@/lib/agent/modules/odontologia";
import { addAppointmentType, saveAppointmentTypeWithFeedback, toggleAppointmentType } from "../../../actions";
import { loadDentalTemplate } from "../../../protocol-actions";
import { EditDetails } from "../edit-details";
import { ActionForm } from "../action-form";
import { Badge, Card, Empty, Field, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import type { AppointmentType, Clinic, Professional, ProfessionalType } from "@/lib/types";
import { ConfigHeader } from "../header";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Prestaciones · Panel" };

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const priceInput = (price: number | string | null) => (price ? String(Number(price)).replace(".", ",") : "");
const hint = "block text-xs text-brand-900/60";

const PRICE_LABEL: Record<AppointmentType["price_mode"], string> = {
  referencia: "Como precio de referencia",
  exacto: "Como precio exacto",
  desde: "Como «desde» (el presupuesto se da en la consulta)",
  no_informar: "No lo dice (el presupuesto se da en el consultorio)",
};

/** Lo que Sofi hace con la prestación: los mismos campos al editar y al agregar. */
function ProtocolFields({ type, others, clinic }: { type?: AppointmentType; others: AppointmentType[]; clinic: Pick<Clinic, "move_panel_only"> }) {
  return (
    <>
      <input type="hidden" name="protocol_fields" value="1" />
      <Field label="Cómo dice el precio Sofi">
        <select name="price_mode" defaultValue={type?.price_mode ?? "referencia"} className={inputClass}>
          {(Object.keys(PRICE_LABEL) as AppointmentType["price_mode"][]).map((m) => <option key={m} value={m}>{PRICE_LABEL[m]}</option>)}
        </select>
      </Field>
      <Field label="Antes tiene que haber tenido" hint="Para reservarla, el paciente tiene que haber tenido (o tener reservada) esta otra.">
        <select name="requires_type_id" defaultValue={type?.requires_type_id ?? ""} className={inputClass}>
          <option value="">Nada</option>
          {others.filter((o) => o.id !== type?.id).map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
        </select>
      </Field>
      <div className="sm:col-span-2">
        <Field label="Qué preguntar antes de reservar" hint="Por ejemplo: «¿Tenés una panorámica reciente?». Sofi anota la respuesta en el turno.">
          <input name="ask_before" defaultValue={type?.ask_before ?? ""} maxLength={300} className={inputClass} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="is_urgent" defaultChecked={type?.is_urgent ?? false} className="mt-1" />
        <span>Es un turno de urgencia<span className={hint}>Sofi busca lugar para hoy y mañana y puede usar las horas «Solo urgencias».</span></span>
      </label>
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="agent_can_reschedule" defaultChecked={type?.agent_can_reschedule ?? true} className="mt-1" />
        <span>
          Si el paciente ya tiene el turno, Sofi lo puede mover
          <span className={hint}>
            Si no, el cambio lo coordina recepción.{type?.panel_only && !clinic.move_panel_only ? " Como la da solo el consultorio, además hay que permitirlo en «Turnos y urgencias»." : ""}
          </span>
        </span>
      </label>
    </>
  );
}

export default async function ServicesPage() {
  const clinic = await getPanelClinic();
  const [types, professionals, links] = await Promise.all([
    sql<AppointmentType[]>`select * from appointment_types where clinic_id = ${clinic.id} order by active desc, specialty, name`,
    sql<Pick<Professional, "id" | "specialty" | "active">[]>`select id, specialty, active from professionals where clinic_id = ${clinic.id}`,
    sql<ProfessionalType[]>`
      select l.professional_id, l.appointment_type_id from professional_appointment_types l
      join professionals p on p.id = l.professional_id where p.clinic_id = ${clinic.id}`,
  ]);
  const specialties = [...new Set([...professionals.map((p) => p.specialty), ...types.map((x) => x.specialty)])];
  const active = professionals.filter((p) => p.active);
  const staffed = (t: AppointmentType) => active.some((p) => professionalDoes(p, t, [...links]));
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const dental = isDentalSpecialty(clinic.specialty) || specialties.some(isDentalSpecialty);

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/prestaciones" />
      <p className="mb-4 max-w-3xl text-sm text-brand-900/60">Los tipos de turno que el agente puede dar. Cada una la atiende un profesional activo de su especialidad, o los que la tengan marcada en Equipo y horarios.</p>
      {dental && (
        <Card className="mb-6">
          <h2 className="font-semibold text-brand-950">Plantilla odontológica</h2>
          <p className="mt-1 text-sm text-brand-900/60">
            Suma las prestaciones comunes de un consultorio odontológico que todavía no tengas (primera consulta, urgencia, limpieza, conducto, implantes, ortodoncia y más), con duraciones de punto de partida. No cambia las que ya están.
          </p>
          <ActionForm action={loadDentalTemplate} submit="Sumar las que faltan" secondary className="mt-3 flex flex-wrap items-center gap-3">
            <input type="hidden" name="clinic_id" value={clinic.id} />
          </ActionForm>
        </Card>
      )}
      <Card className="p-0">
        <ul className="divide-y divide-brand-900/5">
          {types.map((x) => (
            <li key={x.id} className={`px-5 py-3 ${x.active ? "" : "opacity-60"}`}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-950">
                    {x.name} {x.is_first_visit && <Badge tone="blue">primera vez</Badge>} {x.is_urgent && <Badge tone="red">urgencia</Badge>} {x.panel_only && <Badge>solo el consultorio</Badge>}{" "}
                    {!agentCanMove(x, clinic) && !x.panel_only && <Badge>la mueve recepción</Badge>} {!x.active && <Badge>Inactiva</Badge>}
                  </p>
                  <p className="text-sm text-brand-900/65">
                    {x.specialty} · {x.duration_min} min{x.recall_months ? ` · control cada ${x.recall_months} meses` : ""}
                    {x.requires_type_id ? ` · antes: ${typeName.get(x.requires_type_id) ?? "otra prestación"}` : ""}
                    {x.active && !staffed(x) && <span className="text-sun-700"> · ningún profesional activo la hace</span>}
                  </p>
                </div>
                <p className="w-28 text-right text-sm font-medium text-brand-950">
                  {x.price_mode === "no_informar"
                    ? <span className="font-normal text-brand-900/65">No lo dice</span>
                    : x.price ? `${x.price_mode === "desde" ? "desde " : ""}${money.format(Number(x.price))}` : <span className="font-normal text-brand-900/65">Sin precio</span>}
                </p>
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
                  <ProtocolFields type={x} others={types} clinic={clinic} />
                  <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_first_visit" defaultChecked={x.is_first_visit} /> Es primera consulta</label>
                  <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="panel_only" defaultChecked={x.panel_only} className="mt-1" /> <span>Solo la da el consultorio <span className={hint}>Sofi no la ofrece ni la reserva (y no la mueve, salvo que lo permitas en «Turnos y urgencias»). El turno se da desde la Agenda.</span></span></label>
              </EditDetails>
            </li>
          ))}
        </ul>
        {!types.length && <div className="p-5"><Empty>Todavía no hay prestaciones. Agregá la primera abajo{dental ? " o sumá la plantilla odontológica" : ""}.</Empty></div>}
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
          <ProtocolFields others={types} clinic={clinic} />
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="is_first_visit" /> Es primera consulta</label>
          <label className="flex items-start gap-2 text-sm"><input type="checkbox" name="panel_only" className="mt-1" /> <span>Solo la da el consultorio <span className={hint}>Sofi no la ofrece ni la reserva (y no la mueve, salvo que lo permitas en «Turnos y urgencias»). El turno se da desde la Agenda.</span></span></label>
          <div className="sm:col-span-2"><button className={buttonClass}>Agregar prestación</button></div>
        </form>
      </Card>
      <datalist id="specialties">{specialties.map((s) => <option key={s} value={s} />)}</datalist>
    </>
  );
}
