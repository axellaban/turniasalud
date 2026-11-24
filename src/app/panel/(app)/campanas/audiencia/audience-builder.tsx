"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MONTH_OPTIONS, describeRules, hasAnyRule, type AudienceRules } from "@/lib/audience-rules";
import { createAudienceCampaignAction, previewAudienceAction, saveAudienceAction } from "../../../campaign-actions";
import type { AudiencePreview } from "@/lib/saved-audiences";
import { buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";


const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
const selectClass = "min-h-10 rounded-lg border border-brand-900/15 bg-white px-2.5 text-sm font-medium text-brand-950";
const addClass =
  "inline-flex min-h-10 items-center rounded-full border border-dashed border-brand-300 bg-brand-50/60 px-3 text-sm font-semibold text-brand-800 hover:bg-brand-50 disabled:cursor-not-allowed disabled:opacity-55";

function Rule({ label, onRemove, children, hint }: { label: string; onRemove: () => void; children?: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-2.5 rounded-xl border border-brand-900/10 bg-white px-3.5 py-2.5 text-sm">
      <span className="font-semibold text-brand-950">{label}</span>
      {children}
      {hint && <span className="text-xs text-brand-900/60">{hint}</span>}
      <button type="button" onClick={onRemove} aria-label={`Quitar «${label}»`} className="ml-auto grid size-10 place-items-center rounded-full text-lg text-brand-900/60 hover:bg-brand-50">
        ×
      </button>
    </div>
  );
}

function Line({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <span className={`flex justify-between gap-3 ${strong ? "font-semibold text-brand-950" : ""}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
  );
}

export function AudienceBuilder(props: {
  clinicId: string;
  audienceId: string | null;
  initialName: string;
  initialRules: AudienceRules;
  types: Array<{ id: string; name: string }>;
  professionals: Array<{ id: string; full_name: string }>;
  coverages: string[];
  cooldownDays: number;
  externalSource: string | null;
}) {
  const router = useRouter();
  const [name, setName] = useState(props.initialName);
  const [rules, setRules] = useState<AudienceRules>(props.initialRules);
  // Las reglas de selección se muestran aunque estén en «cualquiera» (prestación/profesional).
  const [shown, setShown] = useState({ type: Boolean(props.initialRules.appointmentTypeId), professional: true, age: props.initialRules.ageMin !== null || props.initialRules.ageMax !== null });
  const [preview, setPreview] = useState<AudiencePreview | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [loading, startLoading] = useTransition();
  const [saving, startSaving] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const set = (patch: Partial<AudienceRules>) => setRules((r) => ({ ...r, ...patch }));
  const typeName = props.types.find((t) => t.id === rules.appointmentTypeId)?.name ?? null;
  const proName = props.professionals.find((p) => p.id === rules.professionalId)?.full_name ?? null;
  const valid = hasAnyRule(rules) && (rules.ageMin === null || rules.ageMax === null || rules.ageMin <= rules.ageMax);

  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    if (!valid) return;
    timer.current = setTimeout(() => {
      startLoading(async () => {
        const res = await previewAudienceAction({ clinic_id: props.clinicId, name, rules });
        if (res.ok) {
          setPreview(res.preview);
          setProblem(null);
        } else {
          setPreview(null);
          setProblem(res.message);
        }
      });
    }, 300);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // El nombre no cambia la vista previa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rules, valid, props.clinicId]);

  const save = () =>
    startSaving(async () => {
      const res = await saveAudienceAction({ clinic_id: props.clinicId, id: props.audienceId, name, rules });
      setStatus(res.message ?? null);
      if (res.ok) router.push("/panel/campanas#audiencias");
    });
  // Si sale bien, la acción redirige a la campaña nueva.
  const create = () =>
    startSaving(async () => {
      const res = await createAudienceCampaignAction({ clinic_id: props.clinicId, id: props.audienceId, name: name || describeRules(rules, { type: typeName, professional: proName }).slice(0, 80), rules });
      if (res?.message) setStatus(res.message);
    });

  // Con reglas inválidas no se consulta: se muestra el motivo y no la vista previa anterior.
  const shownProblem = !valid ? (hasAnyRule(rules) ? "La edad mínima no puede ser mayor que la máxima." : "Sumá al menos una regla.") : problem;
  const shownPreview = valid ? preview : null;
  const count = shownPreview?.reachable ?? 0;
  return (
    <div className="overflow-hidden rounded-2xl border border-brand-900/10 bg-[#f5f7fc]">
      <div className="grid grid-cols-1 gap-6 p-4 sm:p-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-3.5">
          <label className="flex flex-col gap-1.5 text-sm font-semibold text-brand-950">
            Nombre
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="Ej. Ortodoncia sin control hace 9 meses" className={inputClass} />
          </label>

          <p className="mt-1 font-bold text-brand-950">Pacientes que…</p>
          {rules.monthsSince !== null && (
            <Rule label="no vienen hace más de" onRemove={() => set({ monthsSince: null })} hint={`última visita en Turnia${props.externalSource ? ` o en ${props.externalSource}` : ""}`}>
              <select aria-label="Meses sin venir" value={rules.monthsSince} onChange={(e) => set({ monthsSince: Number(e.target.value) })} className={selectClass}>
                {MONTH_OPTIONS.map((m) => (
                  <option key={m} value={m}>
                    {m} meses
                  </option>
                ))}
              </select>
            </Rule>
          )}
          {shown.type && (
            <Rule label="se atendieron de" onRemove={() => (set({ appointmentTypeId: null }), setShown((s) => ({ ...s, type: false })))}>
              <select aria-label="Prestación" value={rules.appointmentTypeId ?? ""} onChange={(e) => set({ appointmentTypeId: e.target.value || null })} className={`${selectClass} max-w-full`}>
                <option value="">Cualquier prestación</option>
                {props.types.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </Rule>
          )}
          {shown.professional && (
            <Rule label="con" onRemove={() => (set({ professionalId: null }), setShown((s) => ({ ...s, professional: false })))}>
              <select aria-label="Profesional" value={rules.professionalId ?? ""} onChange={(e) => set({ professionalId: e.target.value || null })} className={selectClass}>
                <option value="">Cualquier profesional</option>
                {props.professionals.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.full_name}
                  </option>
                ))}
              </select>
            </Rule>
          )}
          {rules.coverage !== null && (
            <Rule label="tienen" onRemove={() => set({ coverage: null })}>
              <select aria-label="Cobertura" value={rules.coverage} onChange={(e) => set({ coverage: e.target.value })} className={selectClass}>
                {props.coverages.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </Rule>
          )}
          {shown.age && (
            <Rule label="tienen entre" onRemove={() => (set({ ageMin: null, ageMax: null }), setShown((s) => ({ ...s, age: false })))}>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                aria-label="Edad mínima"
                value={rules.ageMin ?? ""}
                onChange={(e) => set({ ageMin: e.target.value === "" ? null : Number(e.target.value) })}
                className={`${selectClass} w-20`}
              />
              <span className="text-brand-900/70">y</span>
              <input
                type="number"
                inputMode="numeric"
                min={0}
                max={120}
                aria-label="Edad máxima"
                value={rules.ageMax ?? ""}
                onChange={(e) => set({ ageMax: e.target.value === "" ? null : Number(e.target.value) })}
                className={`${selectClass} w-20`}
              />
              <span className="text-brand-900/70">años</span>
            </Rule>
          )}
          {rules.birthdayThisMonth && <Rule label="cumplen años este mes" onRemove={() => set({ birthdayThisMonth: false })} />}
          {rules.noShow && <Rule label="faltaron a un turno" onRemove={() => set({ noShow: false })} hint="en el último año" />}
          {rules.controlIndicated && <Rule label="tienen un control indicado por el profesional" onRemove={() => set({ controlIndicated: false })} hint="que ya llegó y no vinieron" />}

          <div className="mt-0.5 flex flex-wrap gap-2">
            {rules.monthsSince === null && (
              <button type="button" className={addClass} onClick={() => set({ monthsSince: 9 })}>
                + Meses sin venir
              </button>
            )}
            {!shown.type && (
              <button type="button" className={addClass} onClick={() => setShown((s) => ({ ...s, type: true }))}>
                + Prestación
              </button>
            )}
            {!shown.professional && (
              <button type="button" className={addClass} onClick={() => setShown((s) => ({ ...s, professional: true }))}>
                + Profesional
              </button>
            )}
            {rules.coverage === null && (
              <button type="button" className={addClass} disabled={!props.coverages.length} title={props.coverages.length ? undefined : "Ninguna ficha tiene cobertura cargada"} onClick={() => set({ coverage: props.coverages[0] })}>
                + Cobertura
              </button>
            )}
            {!shown.age && (
              <button type="button" className={addClass} onClick={() => (setShown((s) => ({ ...s, age: true })), set({ ageMin: 18, ageMax: 65 }))}>
                + Edad
              </button>
            )}
            {!rules.birthdayThisMonth && (
              <button type="button" className={addClass} onClick={() => set({ birthdayThisMonth: true })}>
                + Cumpleaños este mes
              </button>
            )}
            {!rules.noShow && (
              <button type="button" className={addClass} onClick={() => set({ noShow: true })}>
                + Faltó a un turno
              </button>
            )}
            {!rules.controlIndicated && (
              <button type="button" className={addClass} onClick={() => set({ controlIndicated: true })}>
                + Control indicado por el profesional
              </button>
            )}
            <button type="button" className={addClass} disabled title="Todavía no hay de dónde leer los presupuestos">
              + Presupuesto sin iniciar · conectar origen
            </button>
          </div>

          <div className="mt-auto flex flex-col gap-1.5 rounded-xl border border-brand-900/10 bg-white p-3.5 text-xs text-brand-900/70">
            <b className="text-sm text-brand-950">Siempre quedan afuera</b>
            <span>
              Quienes ya tienen un turno, pidieron no recibir mensajes o recibieron otra campaña hace menos de {props.cooldownDays} días (Reglas de contacto).
            </span>
          </div>
        </div>

        <aside aria-label="Vista previa de la audiencia" aria-busy={loading} className="flex min-w-0 flex-col gap-4 rounded-2xl border border-brand-900/10 bg-white p-5">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <span className="text-xs text-brand-900/65">Se les puede escribir</span>
              <div className={`font-display text-5xl leading-none text-brand-950 tabular-nums ${loading ? "opacity-50" : ""}`} aria-live="polite">
                {shownPreview ? count.toLocaleString("es-AR") : "—"}
              </div>
            </div>
            {shownPreview && shownPreview.value > 0 && (
              <div className="text-right">
                <span className="text-xs text-brand-900/65">Valor estimado en turnos</span>
                <div className="text-lg font-bold text-brand-950">≈ {money.format(shownPreview.value)}</div>
              </div>
            )}
          </div>
          {shownProblem && <p className="rounded-xl bg-sun-100 px-3 py-2 text-sm text-sun-700">{shownProblem}</p>}
          {shownPreview && (
            <>
              <p className="text-sm text-brand-900/75">{shownPreview.sentence}</p>
              <div className="flex flex-col gap-1.5 rounded-xl bg-brand-50/60 p-3 text-sm text-brand-900/75">
                <Line label="Cumplen las reglas" value={shownPreview.matching.toLocaleString("es-AR")} strong />
                {shownPreview.hasAppointment > 0 && <Line label="Ya tienen turno" value={`−${shownPreview.hasAppointment}`} />}
                {shownPreview.recentCampaign > 0 && <Line label="Otra campaña hace poco" value={`−${shownPreview.recentCampaign}`} />}
                {shownPreview.optedOut > 0 && <Line label="Pidieron no recibir mensajes" value={`−${shownPreview.optedOut}`} />}
                {shownPreview.noPhone > 0 && <Line label="Sin celular válido" value={`−${shownPreview.noPhone}`} />}
              </div>
              {shownPreview.sample.length > 0 && (
                <div>
                  <p className="mb-1.5 text-sm font-semibold text-brand-950">Algunos de la lista</p>
                  <ul className="divide-y divide-brand-900/5 text-sm">
                    {shownPreview.sample.map((p, i) => (
                      <li key={i} className="flex justify-between gap-3 py-2">
                        <span>{p.name}</span>
                        <span className="text-xs text-brand-900/60">{p.last}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <p className="mt-auto text-xs text-brand-900/60">Cuenta con la agenda de Turnia{props.externalSource ? `, lo que trae ${props.externalSource}` : ""} y las visitas importadas.</p>
        </aside>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-900/10 bg-white px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={save} disabled={saving || !valid || !name.trim()} className={`${secondaryButtonClass} disabled:opacity-50`}>
            Guardar audiencia
          </button>
          <span aria-live="polite" className="text-xs text-brand-700">
            {status}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-xs text-brand-900/65">Después elegís la secuencia y el mensaje</span>
          <button type="button" onClick={create} disabled={saving || !shownPreview || count === 0} className={`${buttonClass} disabled:opacity-50`}>
            {saving ? "Armando…" : `Crear campaña con ${count === 1 ? "este" : "estos"} ${count.toLocaleString("es-AR")}`}
          </button>
        </div>
      </div>
    </div>
  );
}
