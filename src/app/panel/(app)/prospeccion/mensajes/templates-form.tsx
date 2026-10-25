"use client";

import { useActionState, useState } from "react";
import { Field, Notice, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import type { TemplateKey, Templates } from "@/lib/sales/outreach-messages";
import { saveTemplatesAction } from "../actions";

export function TemplatesForm({
  templates,
  defaults,
  keys,
  labels,
  dailyGoal,
  weeklyGoal,
}: {
  templates: Templates;
  defaults: Templates;
  keys: TemplateKey[];
  labels: Record<TemplateKey, { title: string; hint: string }>;
  dailyGoal: number;
  weeklyGoal: number;
}) {
  const [state, action, pending] = useActionState(saveTemplatesAction, undefined);
  const [values, setValues] = useState(templates);
  return (
    <form action={action} className="mt-5 space-y-6">
      <div className="grid gap-4 sm:grid-cols-2 sm:max-w-md">
        <Field label="Primeros contactos por día" hint="De a uno. Más de 50 por día desde un mismo número es riesgoso.">
          <input name="daily_goal" type="number" min={1} max={200} defaultValue={dailyGoal} className={inputClass} />
        </Field>
        <Field label="Meta de la semana">
          <input name="weekly_goal" type="number" min={1} max={2000} defaultValue={weeklyGoal} className={inputClass} />
        </Field>
      </div>
      {keys.map((key) => (
        <div key={key}>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <label htmlFor={`tpl-${key}`} className="text-sm font-semibold text-brand-950">
              {labels[key].title}
            </label>
            {values[key] !== defaults[key] && (
              <button type="button" onClick={() => setValues((v) => ({ ...v, [key]: defaults[key] }))} className={smallButtonClass}>
                Volver al original
              </button>
            )}
          </div>
          <p className="text-xs text-brand-900/65">{labels[key].hint}</p>
          <textarea
            id={`tpl-${key}`}
            name={key}
            rows={key === "whatsapp_3" ? 2 : 5}
            maxLength={1500}
            value={values[key]}
            onChange={(e) => setValues((v) => ({ ...v, [key]: e.target.value }))}
            className={`${inputClass} mt-2`}
          />
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={buttonClass}>
          {pending ? "Guardando…" : "Guardar mensajes"}
        </button>
        {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
      </div>
    </form>
  );
}
