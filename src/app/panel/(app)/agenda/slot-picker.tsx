"use client";

import { useEffect, useState } from "react";
import { loadDaySlots } from "../../actions";
import { Field, ghostButtonClass, inputClass } from "@/components/ui";
import type { DaySlot } from "@/lib/agent/service";

type Day = { turnos: DaySlot[]; horario: string | null; motivo: string | null };

export const shiftDay = (key: string, days: number) => {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

export const dayLabel = (key: string) => {
  const [, m, d] = key.split("-").map(Number);
  const weekday = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "short" }).format(new Date(`${key}T12:00:00Z`));
  return `${weekday.replace(".", "")} ${d}/${m}`;
};

const chipClass = (selected: boolean) =>
  `rounded-lg px-2 py-1.5 text-sm font-medium tabular-nums ring-1 transition-colors ${
    selected ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-brand-900 ring-brand-900/15 hover:bg-brand-50 hover:ring-brand-300"
  }`;

/**
 * Día y horario de un turno: los horarios libres del día como botones (ya descuentan
 * turnos, bloqueos y lo ocupado en Google Calendar), o una hora escrita a mano.
 * Manda `date` y `time` con el formulario.
 */
export function SlotPicker({
  clinicId,
  typeId,
  proId,
  today,
  date,
  onDate,
  time,
  onTime,
  custom,
  onCustom,
  reload = 0,
  ignoreId,
  secondId,
}: {
  clinicId: string;
  typeId: string;
  proId: string;
  today: string;
  date: string;
  onDate: (date: string) => void;
  time: string;
  onTime: (time: string) => void;
  custom: boolean;
  onCustom: (custom: boolean) => void;
  /** Cambiarlo vuelve a traer los horarios (por ejemplo, después de reservar). */
  reload?: number;
  /** El turno que se está moviendo: su horario cuenta como libre. */
  ignoreId?: string;
  /** Otro profesional que atiende el mismo turno: solo sirven los horarios en que los dos están libres. */
  secondId?: string;
}) {
  // Los horarios libres son de una combinación prestación + profesional + día: mientras
  // llega la de la combinación actual, se muestra la anterior atenuada.
  const key = `${typeId}|${proId}|${date}|${reload}|${ignoreId ?? ""}|${secondId ?? ""}`;
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
    if (ignoreId) data.set("ignore_id", ignoreId);
    if (secondId) data.set("second_professional_id", secondId);
    loadDaySlots(data)
      .then((r) => { if (current) setLoaded({ key, day: r }); })
      .catch(() => { if (current) setLoaded({ key, day: { turnos: [], horario: null, motivo: "No pude traer los horarios. Probá de nuevo." } }); });
    return () => { current = false; };
  }, [clinicId, typeId, proId, date, ignoreId, secondId, key]);

  const goTo = (next: string) => {
    onDate(next);
    if (!custom) onTime("");
  };
  const morning = day?.turnos.filter((s) => s.hora < "13:00") ?? [];
  const afternoon = day?.turnos.filter((s) => s.hora >= "13:00") ?? [];

  return (
    <>
      <Field label="Día">
        <div className="flex items-center gap-1.5">
          <button type="button" aria-label="Día anterior" disabled={date <= today} onClick={() => goTo(shiftDay(date, -1))} className={`${ghostButtonClass} px-2.5 disabled:opacity-30`}>‹</button>
          <input type="date" name="date" required min={today} value={date} onChange={(e) => e.target.value && goTo(e.target.value)} className={inputClass} />
          <button type="button" aria-label="Día siguiente" onClick={() => goTo(shiftDay(date, 1))} className={`${ghostButtonClass} px-2.5`}>›</button>
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
              onChange={(e) => onTime(e.target.value)}
              className={inputClass}
            />
            <button type="button" onClick={() => { onCustom(false); onTime(""); }} className="text-xs font-medium text-brand-700 hover:underline">
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
                <button type="button" onClick={() => goTo(shiftDay(date, 1))} className="mt-1 font-medium text-brand-700 hover:underline">
                  Ver el día siguiente →
                </button>
              </div>
            ) : (
              <div className={`mt-1.5 space-y-2 ${loading ? "opacity-50" : ""}`}>
                {([["Mañana", morning], ["Tarde", afternoon]] as const).map(([label, list]) =>
                  list.length ? (
                    <div key={label}>
                      <p className="mb-1 text-xs text-brand-900/55">{label}</p>
                      <div className="grid grid-cols-4 gap-1.5" role="group" aria-label={`Horarios de la ${label.toLowerCase()}`}>
                        {list.map((s) => (
                          <button key={s.inicio} type="button" aria-pressed={time === s.hora} onClick={() => onTime(time === s.hora ? "" : s.hora)} className={chipClass(time === s.hora)}>
                            {s.hora}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null,
                )}
              </div>
            )}
            <button type="button" onClick={() => { onCustom(true); onTime(""); }} className="mt-2 text-xs font-medium text-brand-700 hover:underline">
              Otro horario (escribirlo)
            </button>
          </>
        )}
      </div>
    </>
  );
}

/**
 * Cuando el horario es fuera de la atención, un día bloqueado u ocupado en Google,
 * el consultorio lo puede dar igual: lo decide quien está en el panel, no el agente.
 */
export function ForceOption({ show }: { show: boolean | undefined }) {
  if (!show) return null;
  return (
    <label className="flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900 ring-1 ring-amber-200">
      <input type="checkbox" name="force" value="1" className="mt-0.5 h-4 w-4 accent-amber-600" />
      <span>Darlo igual: el profesional lo atiende en ese horario. El agente nunca lo ofrece por su cuenta.</span>
    </label>
  );
}
