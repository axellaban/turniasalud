import type { Metadata } from "next";
import { getPanelClinic } from "@/lib/panel-clinic";
import { sql } from "@/lib/db";
import { coverageRuleText } from "@/lib/booking-rules";
import { Badge, Card, Empty, Field, inputClass, smallButtonClass } from "@/components/ui";
import type { AppointmentType, CoverageRule, Professional } from "@/lib/types";
import { addCoverageRule, deleteCoverageRule, saveCoverageRule } from "../../../protocol-actions";
import { ActionForm } from "../action-form";
import { EditDetails } from "../edit-details";
import { ConfigHeader } from "../header";

export const metadata: Metadata = { title: "Coberturas · Panel" };

/** Sugerencias para escribir rápido; el consultorio puede poner cualquier otra. */
const COMMON = [
  "Particular", "OSDE", "Swiss Medical", "Galeno", "Medifé", "OMINT", "Sancor Salud", "Prevención Salud", "Accord Salud",
  "Avalian", "Medicus", "Hospital Italiano", "Hospital Alemán", "Federada Salud", "OSDEPYM", "IOMA", "PAMI",
];

const MODE_LABEL: Record<CoverageRule["mode"], string> = {
  acepta: "La acepta",
  copago: "La acepta con copago",
  reintegro: "Por reintegro (paga y pide el reintegro)",
  no_acepta: "No la acepta (ofrecer particular)",
};
const MODE_TONE: Record<CoverageRule["mode"], "green" | "yellow" | "blue" | "red"> = { acepta: "green", copago: "yellow", reintegro: "blue", no_acepta: "red" };

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const amountInput = (value: string | null) => (value ? String(Number(value)).replace(".", ",") : "");

function RuleFields({ rule, types, pros }: { rule?: CoverageRule; types: Array<Pick<AppointmentType, "id" | "name">>; pros: Array<Pick<Professional, "id" | "full_name">> }) {
  return (
    <>
      <Field label="Obra social, prepaga o «Particular»">
        <input name="coverage" required list="coverages" defaultValue={rule?.coverage ?? ""} placeholder="OSDE" className={inputClass} />
      </Field>
      <Field label="Plan (opcional)" hint="Vacío: todos los planes.">
        <input name="plan" defaultValue={rule?.plan ?? ""} placeholder="210" className={inputClass} />
      </Field>
      <Field label="Prestación (opcional)">
        <select name="appointment_type_id" defaultValue={rule?.appointment_type_id ?? ""} className={inputClass}>
          <option value="">Todas</option>
          {types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </Field>
      <Field label="Profesional (opcional)">
        <select name="professional_id" defaultValue={rule?.professional_id ?? ""} className={inputClass}>
          <option value="">Todos</option>
          {pros.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
        </select>
      </Field>
      <Field label="Qué pasa">
        <select name="mode" required defaultValue={rule?.mode ?? "acepta"} className={inputClass}>
          {(Object.keys(MODE_LABEL) as CoverageRule["mode"][]).map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
        </select>
      </Field>
      <Field label="Copago (si corresponde)" hint="Sofi se lo dice al paciente al ofrecer el turno.">
        <input name="copay" inputMode="decimal" defaultValue={amountInput(rule?.copay ?? null)} placeholder="5000" className={inputClass} />
      </Field>
      <div className="sm:col-span-2">
        <Field label="Nota (opcional)" hint="Algo más que Sofi tenga que decir, por ejemplo «traer el bono».">
          <input name="note" defaultValue={rule?.note ?? ""} maxLength={200} className={inputClass} />
        </Field>
      </div>
      <label className="flex items-start gap-2 text-sm sm:col-span-2">
        <input type="checkbox" name="requires_authorization" defaultChecked={rule?.requires_authorization ?? false} className="mt-1" />
        <span>Necesita autorización u orden de la prepaga antes del turno<span className="block text-xs text-brand-900/60">Sofi le avisa al paciente que la traiga.</span></span>
      </label>
    </>
  );
}

export default async function CoveragePage() {
  const clinic = await getPanelClinic();
  const [rules, types, pros] = await Promise.all([
    sql<CoverageRule[]>`select * from coverage_rules where clinic_id = ${clinic.id} order by coverage, plan nulls first, created_at`,
    sql<Array<Pick<AppointmentType, "id" | "name">>>`select id, name from appointment_types where clinic_id = ${clinic.id} and active order by name`,
    sql<Array<Pick<Professional, "id" | "full_name" | "accepted_coverages">>>`select id, full_name, accepted_coverages from professionals where clinic_id = ${clinic.id} and active order by full_name`,
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.name]));
  const proName = new Map(pros.map((p) => [p.id, p.full_name]));
  const suggestions = [...new Set([...COMMON, ...clinic.accepted_coverages, ...pros.flatMap((p) => p.accepted_coverages ?? [])])];
  const limited = pros.filter((p) => p.accepted_coverages?.length);

  return (
    <>
      <ConfigHeader clinic={clinic} current="/panel/configuracion/coberturas" />
      <div className="mb-4 max-w-3xl space-y-2 text-sm text-brand-900/60">
        <p>Qué pasa con cada obra social o prepaga: por plan, por prestación o por profesional. Sofi no ofrece horarios con quien no la acepta y avisa el copago, el reintegro o la autorización antes de reservar.</p>
        <p>Si hay varias reglas, manda la más específica (prestación, después profesional, después plan). Particular siempre se puede, salvo que una regla diga lo contrario. Sin reglas, vale la lista de coberturas de cada profesional.</p>
      </div>

      <Card className="p-0">
        <ul className="divide-y divide-brand-900/5">
          {rules.map((r) => (
            <li key={r.id} className="px-5 py-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-brand-950">
                    {r.coverage}{r.plan ? ` · plan ${r.plan}` : ""} <Badge tone={MODE_TONE[r.mode]}>{MODE_LABEL[r.mode]}</Badge>
                    {r.requires_authorization && <> <Badge tone="blue">autorización</Badge></>}
                  </p>
                  <p className="text-sm text-brand-900/65">
                    {r.appointment_type_id ? (typeName.get(r.appointment_type_id) ?? "Prestación inactiva") : "Todas las prestaciones"}
                    {" · "}{r.professional_id ? (proName.get(r.professional_id) ?? "Profesional inactivo") : "todos los profesionales"}
                    {r.mode === "copago" && r.copay ? ` · copago ${money.format(Number(r.copay))}` : ""}
                    {r.note ? ` · ${r.note}` : ""}
                  </p>
                </div>
                <form action={deleteCoverageRule}>
                  <input type="hidden" name="clinic_id" value={clinic.id} />
                  <input type="hidden" name="id" value={r.id} />
                  <button className={smallButtonClass} aria-label={`Borrar la regla de ${r.coverage}`}>Borrar</button>
                </form>
              </div>
              <EditDetails summary="Editar regla" submit="Guardar regla" action={saveCoverageRule} className="mt-3 grid gap-3 rounded-xl bg-neutral-50 p-4 sm:grid-cols-2">
                <input type="hidden" name="clinic_id" value={clinic.id} />
                <input type="hidden" name="id" value={r.id} />
                <RuleFields rule={r} types={types} pros={pros} />
              </EditDetails>
            </li>
          ))}
        </ul>
        {!rules.length && <div className="p-5"><Empty>Todavía no hay reglas. Sofi usa la lista de coberturas de cada profesional.</Empty></div>}
      </Card>

      <Card className="mt-6">
        <h2 className="mb-4 font-semibold text-brand-950">Agregar regla</h2>
        <ActionForm action={addCoverageRule} submit="Agregar regla" resetOnSuccess className="grid gap-3 sm:grid-cols-2">
          <input type="hidden" name="clinic_id" value={clinic.id} />
          <RuleFields types={types} pros={pros} />
        </ActionForm>
      </Card>

      {(rules.length > 0 || limited.length > 0) && (
        <Card className="mt-6">
          <h2 className="font-semibold text-brand-950">Lo que sabe Sofi</h2>
          <ul className="mt-2 space-y-1 text-sm text-brand-900/80">
            {limited.map((p) => <li key={p.id}>- {p.full_name}: solo {p.accepted_coverages!.join(", ")} (se cambia en Equipo y horarios)</li>)}
            {rules.map((r) => (
              <li key={r.id}>
                {coverageRuleText(r, {
                  type: r.appointment_type_id ? typeName.get(r.appointment_type_id) : undefined,
                  professional: r.professional_id ? proName.get(r.professional_id) : undefined,
                })}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <datalist id="coverages">{suggestions.map((c) => <option key={c} value={c} />)}</datalist>
    </>
  );
}
