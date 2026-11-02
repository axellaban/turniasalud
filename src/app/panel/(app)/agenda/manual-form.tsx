"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitKeepingValues } from "@/components/keep-form";
import { createManualAppointment, lookupPatient, type KnownPatient } from "../../actions";
import { Field, buttonClass, inputClass } from "@/components/ui";
import { parseClockTime } from "@/lib/time";
import { ForceOption, SlotPicker, dayLabel } from "./slot-picker";

type Option = { id: string; name: string; specialty: string };

/**
 * Turno a mano: primero qué, con quién y cuándo (se elige entre los horarios libres
 * del día, que ya descuentan turnos, bloqueos y lo ocupado en Google Calendar);
 * después los datos del paciente.
 */
export function ManualAppointmentForm({
  clinicId,
  defaultDate,
  today,
  professionals,
  types,
  initialProId,
  initialTime,
}: {
  clinicId: string;
  defaultDate: string;
  today: string;
  professionals: Option[];
  types: Option[];
  /** Al tocar un hueco de la grilla: con quién y a qué hora. */
  initialProId?: string;
  initialTime?: string;
}) {
  const [state, action, pending] = useActionState(createManualAppointment, undefined);
  const form = useRef<HTMLFormElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const coverageRef = useRef<HTMLInputElement>(null);
  const initialPro = professionals.find((p) => p.id === initialProId);
  const [typeId, setTypeId] = useState((initialPro && types.find((t) => t.specialty === initialPro.specialty)?.id) ?? types[0]?.id ?? "");
  const specialty = types.find((t) => t.id === typeId)?.specialty;
  const pros = professionals.filter((p) => p.specialty === specialty);
  const [chosenPro, setProId] = useState(initialPro?.id ?? pros[0]?.id ?? "");
  // Al cambiar de prestación, si el profesional elegido no la hace, va el primero que sí.
  const proId = pros.some((p) => p.id === chosenPro) ? chosenPro : (pros[0]?.id ?? "");
  // Turno con dos profesionales (por ejemplo, una cirugía conjunta): el otro puede ser de cualquier especialidad.
  const [chosenSecond, setSecondId] = useState("");
  const secondId = chosenSecond === proId ? "" : chosenSecond;
  const [date, setDate] = useState(defaultDate < today ? today : defaultDate);
  const [time, setTime] = useState(initialTime ?? "");
  const [custom, setCustom] = useState(false);
  const [reload, setReload] = useState(0);
  // Fichas de ese celular (una familia puede tener varias) y para quién es el turno: una de ellas o «nueva».
  const [known, setKnown] = useState<KnownPatient[]>([]);
  const [patientId, setPatientId] = useState("");
  // «Darlo igual» vale para el horario que se rechazó: si se elige otro, desaparece.
  const slotKey = `${proId}|${secondId}|${date}|${time}`;
  const [forceKey, setForceKey] = useState<string | null>(null);

  // Turno reservado: se vacían el horario y el paciente, y se recargan los horarios libres.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    setForceKey(state?.forzable ? slotKey : null);
    if (state?.ok) {
      setTime("");
      setSecondId("");
      setCustom(false);
      setKnown([]);
      setPatientId("");
      setReload((n) => n + 1);
    }
  }
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);

  // Si el celular ya es de un paciente, se completa su nombre y su cobertura (sin pisar lo escrito).
  async function recognize(phone: string) {
    const data = new FormData();
    data.set("clinic_id", clinicId);
    data.set("phone", phone);
    const found = await lookupPatient(data).catch(() => []);
    setKnown(found);
    setPatientId(found[0]?.id ?? "");
    const first = found[0];
    if (!first) return;
    if (nameRef.current && !nameRef.current.value && first.name) nameRef.current.value = first.name;
    if (coverageRef.current && !coverageRef.current.value && first.coverage) coverageRef.current.value = first.coverage;
  }

  // Al elegir para quién es, se completan sus datos; para una persona nueva, el nombre queda para escribir.
  function choose(id: string) {
    setPatientId(id);
    const chosen = known.find((k) => k.id === id);
    if (nameRef.current) nameRef.current.value = chosen?.name ?? "";
    if (coverageRef.current) coverageRef.current.value = chosen?.coverage ?? "";
    if (!chosen) nameRef.current?.focus();
  }

  const pick = (next: Partial<{ typeId: string; proId: string; secondId: string }>) => {
    if (next.typeId !== undefined) setTypeId(next.typeId);
    if (next.proId !== undefined) setProId(next.proId);
    if (next.secondId !== undefined) setSecondId(next.secondId);
    if (!custom) setTime("");
  };
  const canSubmit = Boolean(typeId && proId && date && time.trim()) && !pending;

  if (!types.length || !professionals.length) {
    return <p className="text-sm text-brand-900/65">Cargá prestaciones y profesionales en Configuración para dar turnos a mano.</p>;
  }

  return (
    <form ref={form} onSubmit={submitKeepingValues(action)} className="space-y-5">
      <input type="hidden" name="clinic_id" value={clinicId} />
      <fieldset className="space-y-3">
        <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-900/55">Turno</legend>
        <Field label="Prestación">
          <select name="appointment_type_id" value={typeId} onChange={(e) => pick({ typeId: e.target.value })} className={inputClass}>
            {types.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Profesional">
          <select name="professional_id" value={proId} onChange={(e) => pick({ proId: e.target.value })} className={inputClass}>
            {pros.map((p) => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
            {!pros.length && <option value="">Nadie hace esta prestación</option>}
          </select>
        </Field>
        {professionals.length > 1 && (
          <Field label="También atiende" hint="Opcional. Para un turno que hacen dos (por ejemplo, una cirugía): queda en la agenda de los dos.">
            <select name="second_professional_id" value={secondId} onChange={(e) => pick({ secondId: e.target.value })} className={inputClass}>
              <option value="">Nadie más</option>
              {professionals.filter((p) => p.id !== proId).map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>
        )}
        <SlotPicker
          clinicId={clinicId}
          typeId={typeId}
          proId={proId}
          today={today}
          date={date}
          onDate={setDate}
          time={time}
          onTime={setTime}
          custom={custom}
          onCustom={setCustom}
          reload={reload}
          secondId={secondId || undefined}
        />
      </fieldset>

      <fieldset className="space-y-3 border-t border-brand-900/10 pt-4">
        <legend className="sr-only">Paciente</legend>
        <p aria-hidden className="text-xs font-semibold uppercase tracking-wide text-brand-900/55">Paciente</p>
        <Field label="Celular" hint="Con código de área. Si ya es paciente, completamos sus datos.">
          <input
            name="phone"
            required
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="11 5555-0001"
            onBlur={(e) => e.target.value.trim() && recognize(e.target.value)}
            onChange={() => {
              if (known.length) setKnown([]);
              setPatientId("");
            }}
            className={inputClass}
          />
        </Field>
        <input type="hidden" name="patient_id" value={patientId} />
        {known.length > 0 && (
          <fieldset className="rounded-xl bg-brand-50/70 px-3 py-2 text-xs leading-relaxed text-brand-900">
            <legend className="sr-only">Para quién es el turno</legend>
            <p role="status" className="font-medium">
              {known.length === 1 ? "Este celular ya tiene una ficha. ¿Para quién es el turno?" : `Este celular tiene ${known.length} fichas (una familia). ¿Para quién es el turno?`}
            </p>
            <div className="mt-1.5 space-y-1">
              {[...known, { id: "nueva", name: null, coverage: null, upcoming: [] }].map((k) => (
                <label key={k.id} className="flex cursor-pointer items-start gap-2">
                  <input type="radio" name="patient_choice" checked={patientId === k.id} onChange={() => choose(k.id)} className="mt-0.5" />
                  <span>
                    <span className="font-medium">{k.id === "nueva" ? "Otra persona (ficha nueva con este celular)" : (k.name ?? "Paciente sin nombre")}</span>
                    {k.upcoming.length > 0 && <span className="block text-brand-900/70">Próximos turnos: {k.upcoming.join(" · ")}.</span>}
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <Field label="Nombre y apellido">
          <input ref={nameRef} name="full_name" required autoComplete="off" className={inputClass} />
        </Field>
        <Field label="Cobertura" hint="Opcional. Si no la sabés, dejala vacía.">
          <input ref={coverageRef} name="coverage" placeholder="OSDE, Swiss Medical, Particular…" className={inputClass} />
        </Field>
        <Field label="Notas" hint="Opcional. Solo las ve el consultorio.">
          <input name="notes" className={inputClass} />
        </Field>
      </fieldset>

      {state?.message && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>
      )}
      <ForceOption key={slotKey} show={forceKey === slotKey} />
      <button disabled={!canSubmit} className={`${buttonClass} w-full`}>
        {pending ? "Reservando…" : !time.trim() ? "Elegí un horario" : parseClockTime(time) ? `Reservar ${dayLabel(date)} · ${parseClockTime(time)}` : "Reservar turno"}
      </button>
    </form>
  );
}
