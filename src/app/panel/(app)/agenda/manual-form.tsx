"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { submitKeepingValues } from "@/components/keep-form";
import { createManualAppointment, loadDaySlots } from "../../actions";
import { Field, buttonClass, ghostButtonClass, inputClass } from "@/components/ui";
import type { DaySlot } from "@/lib/agent/service";
import { parseClockTime } from "@/lib/time";

type Option = { id: string; name: string; specialty: string };
type Day = { turnos: DaySlot[]; horario: string | null; motivo: string | null };

const shiftDay = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const dayLabel = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" }).format(new Date(`${key}T12:00:00Z`));
  return `${weekday.replace(".", "")} ${d}/${m}`;
};

const chipClass = (selected: boolean) =>
  `rounded-lg px-2 py-1.5 text-sm font-medium tabular-nums ring-1 transition-colors ${
    selected ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-brand-900 ring-brand-900/15 hover:bg-brand-50 hover:ring-brand-300"
  }`;

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
  const initialPro = professionals.find((p) => p.id === initialProId);
  const [typeId, setTypeId] = useState((initialPro && types.find((t) => t.specialty === initialPro.specialty)?.id) ?? types[0]?.id ?? "");
  const specialty = types.find((t) => t.id === typeId)?.specialty;
  const pros = professionals.filter((p) => p.specialty === specialty);
  const [chosenPro, setProId] = useState(initialPro?.id ?? pros[0]?.id ?? "");
  // Al cambiar de prestación, si el profesional elegido no la hace, va el primero que sí.
  const proId = pros.some((p) => p.id === chosenPro) ? chosenPro : (pros[0]?.id ?? "");
  const [date, setDate] = useState(defaultDate < today ? today : defaultDate);
  const [time, setTime] = useState(initialTime ?? "");
  const [custom, setCustom] = useState(false);
  const [reload, setReload] = useState(0);
  // Los horarios libres son de una combinación prestación + profesional + día: mientras
  // llega la de la combinación actual, se muestra la anterior atenuada.
  const key = `${typeId}|${proId}|${date}|${reload}`;
  const [loaded, setLoaded] = useState<{ key: string; day: Day } | null>(null);
  const day = loaded?.day ?? null;
  const loading = Boolean(typeId && proId && date) && loaded?.key !== key;

  useEffect(() => {
    if (!typeId || !proId || !date) return;
    let current = true;
    const data = new FormData();
    data.set("clinic_id", clinicId);
    data.set("appointment_type_id", typeId);
    data.set("professional_id", proId);
    data.set("date", date);
    loadDaySlots(data)
      .then((r) => { if (current) setLoaded({ key, day: r }); })
      .catch(() => { if (current) setLoaded({ key, day: { turnos: [], horario: null, motivo: "No pude traer los horarios. Probá de nuevo." } }); });
    return () => { current = false; };
  }, [clinicId, typeId, proId, date, key]);

  // Turno reservado: se vacían el horario y el paciente, y se recargan los horarios libres.
  const [seen, setSeen] = useState(state);
  if (state !== seen) {
    setSeen(state);
    if (state?.ok) {
      setTime("");
      setCustom(false);
      setReload((n) => n + 1);
    }
  }
  useEffect(() => { if (state?.ok) form.current?.reset(); }, [state]);

  const pick = (next: Partial<{ typeId: string; proId: string; date: string }>) => {
    if (next.typeId !== undefined) setTypeId(next.typeId);
    if (next.proId !== undefined) setProId(next.proId);
    if (next.date !== undefined) setDate(next.date);
    if (!custom) setTime("");
  };

  const morning = day?.turnos.filter((s) => s.hora < "13:00") ?? [];
  const afternoon = day?.turnos.filter((s) => s.hora >= "13:00") ?? [];
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
        <Field label="Día">
          <div className="flex items-center gap-1.5">
            <button type="button" aria-label="Día anterior" disabled={date <= today} onClick={() => pick({ date: shiftDay(date, -1) })} className={`${ghostButtonClass} px-2.5 disabled:opacity-30`}>‹</button>
            <input type="date" name="date" required min={today} value={date} onChange={(e) => e.target.value && pick({ date: e.target.value })} className={inputClass} />
            <button type="button" aria-label="Día siguiente" onClick={() => pick({ date: shiftDay(date, 1) })} className={`${ghostButtonClass} px-2.5`}>›</button>
          </div>
        </Field>

        <div aria-live="polite">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium text-brand-900">Horario</span>
            {day?.horario && !loading && <span className="text-xs text-brand-900/60">Atiende de {day.horario}</span>}
          </div>
          {custom ? (
            <div className="mt-1.5 space-y-1.5">
              <input
                name="time"
                autoFocus
                inputMode="numeric"
                autoComplete="off"
                placeholder="Ej.: 9:15 o 19:30"
                value={time}
                onChange={(e) => setTime(e.target.value)}
                className={inputClass}
              />
              <button type="button" onClick={() => { setCustom(false); setTime(""); }} className="text-xs font-medium text-brand-700 hover:underline">
                Elegir de los horarios libres
              </button>
            </div>
          ) : (
            <>
              <input type="hidden" name="time" value={time} />
              {loading && !day?.turnos.length ? (
                <div className="mt-1.5 grid grid-cols-4 gap-1.5" aria-label="Buscando horarios libres">
                  {Array.from({ length: 8 }, (_, i) => <span key={i} className="h-8 animate-pulse rounded-lg bg-brand-900/5" />)}
                </div>
              ) : day && !day.turnos.length ? (
                <div className="mt-1.5 rounded-xl bg-brand-50/60 p-3 text-sm text-brand-900/75">
                  <p>{day.motivo}</p>
                  <button type="button" onClick={() => pick({ date: shiftDay(date, 1) })} className="mt-1 font-medium text-brand-700 hover:underline">
                    Ver el día siguiente →
                  </button>
                </div>
              ) : (
                <div className={`mt-1.5 space-y-2 ${loading ? "opacity-50" : ""}`}>
                  {[["Mañana", morning], ["Tarde", afternoon]].map(([label, list]) =>
                    (list as DaySlot[]).length ? (
                      <div key={label as string}>
                        <p className="mb-1 text-xs text-brand-900/55">{label as string}</p>
                        <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Horarios de la ${(label as string).toLowerCase()}`}>
                          {(list as DaySlot[]).map((s) => (
                            <button key={s.inicio} type="button" aria-pressed={time === s.hora} onClick={() => setTime(time === s.hora ? "" : s.hora)} className={chipClass(time === s.hora)}>
                              {s.hora}
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null,
                  )}
                </div>
              )}
              <button type="button" onClick={() => { setCustom(true); setTime(""); }} className="mt-2 text-xs font-medium text-brand-700 hover:underline">
                Otro horario (escribirlo)
              </button>
            </>
          )}
        </div>
      </fieldset>

      <fieldset className="space-y-3 border-t border-brand-900/10 pt-4">
        <legend className="sr-only">Paciente</legend>
        <p aria-hidden className="text-xs font-semibold uppercase tracking-wide text-brand-900/55">Paciente</p>
        <Field label="Celular">
          <input name="phone" required type="tel" inputMode="tel" autoComplete="off" placeholder="11 5555-0001" className={inputClass} />
        </Field>
        <Field label="Nombre y apellido">
          <input name="full_name" required autoComplete="off" className={inputClass} />
        </Field>
        <Field label="Cobertura" hint="Opcional. Si no la sabés, dejala vacía.">
          <input name="coverage" placeholder="OSDE, Swiss Medical, Particular…" className={inputClass} />
        </Field>
        <Field label="Notas" hint="Opcional. Solo las ve el consultorio.">
          <input name="notes" className={inputClass} />
        </Field>
      </fieldset>

      {state?.message && (
        <p role="status" className={`rounded-xl px-3 py-2 text-sm ${state.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`}>{state.message}</p>
      )}
      <button disabled={!canSubmit} className={`${buttonClass} w-full`}>
        {pending ? "Reservando…" : !time.trim() ? "Elegí un horario" : parseClockTime(time) ? `Reservar ${dayLabel(date)} · ${parseClockTime(time)}` : "Reservar turno"}
      </button>
    </form>
  );
}
