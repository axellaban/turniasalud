"use client";

import { useActionState } from "react";
import { Field, Notice, buttonClass, inputClass, smallButtonClass } from "@/components/ui";
import type { Outreach } from "@/lib/sales/outreach";
import { displayOutreachPhone } from "@/lib/sales/outreach-messages";
import { noteAction, updateOutreachAction } from "../actions";

export function EditOutreachForm({ p }: { p: Outreach }) {
  const [state, action, pending] = useActionState(updateOutreachAction, undefined);
  return (
    <form action={action} className="mt-4 space-y-4">
      <input type="hidden" name="id" value={p.id} />
      <div className="grid gap-4 sm:grid-cols-[6rem_minmax(0,1fr)_minmax(0,12rem)]">
        <Field label="Trato">
          <select name="title" defaultValue={p.title} className={inputClass}>
            <option value="">—</option>
            <option value="Dra.">Dra.</option>
            <option value="Dr.">Dr.</option>
          </select>
        </Field>
        <Field label="Nombre completo">
          <input name="name" defaultValue={p.name} required minLength={2} maxLength={160} className={inputClass} />
        </Field>
        <Field label="Saludo" hint="Va después de «Hola».">
          <input name="greeting" defaultValue={p.greeting} maxLength={60} className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Consultorio" hint="El nombre que ve en su demo.">
          <input name="business_name" defaultValue={p.business_name} maxLength={160} className={inputClass} />
        </Field>
        <Field label="Especialidad">
          <input name="specialty" defaultValue={p.specialty} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Dirección">
          <input name="address" defaultValue={p.address} maxLength={200} className={inputClass} />
        </Field>
        <Field label="Zona">
          <input name="zone" defaultValue={p.zone} maxLength={80} className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_9rem]">
        <Field label="Teléfono" hint={p.phone ? `Hoy: ${displayOutreachPhone(p.phone)}` : "Con código de área: 223 512-3456"}>
          <input name="phone" type="tel" defaultValue={p.phone ?? ""} className={inputClass} />
        </Field>
        <Field label="Tipo">
          <select name="phone_kind" defaultValue={p.phone_kind ?? "movil"} className={inputClass}>
            <option value="movil">Celular</option>
            <option value="fijo">Fijo</option>
          </select>
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Instagram">
          <input name="instagram" defaultValue={p.instagram ? `@${p.instagram}` : ""} placeholder="@usuario" className={inputClass} />
        </Field>
        <Field label="Email">
          <input name="email" type="email" defaultValue={p.email ?? ""} className={inputClass} />
        </Field>
        <Field label="Web" hint="Si tiene, la demo lee su web.">
          <input name="website" defaultValue={p.website ?? ""} placeholder="miconsultorio.com.ar" className={inputClass} />
        </Field>
      </div>
      <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_10rem_8rem]">
        <Field label="Notas">
          <textarea name="notes" defaultValue={p.notes} rows={3} maxLength={4000} className={inputClass} />
        </Field>
        <Field label="Próximo paso" hint="Aparece en «Para hoy» ese día.">
          <input name="next_action_on" type="date" defaultValue={p.next_action_on ?? ""} className={inputClass} />
        </Field>
        <Field label="Prioridad">
          <select name="priority" defaultValue={String(p.priority)} className={inputClass}>
            <option value="1">1 · alta</option>
            <option value="2">2</option>
            <option value="3">3 · baja</option>
          </select>
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={pending} className={buttonClass}>
          {pending ? "Guardando…" : "Guardar"}
        </button>
        {state && <Notice tone={state.ok ? "success" : "error"}>{state.message}</Notice>}
      </div>
    </form>
  );
}

export function NoteForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(noteAction, undefined);
  return (
    <form action={action} className="mt-3 flex gap-2">
      <input type="hidden" name="id" value={id} />
      <label className="flex-1">
        <span className="sr-only">Nota</span>
        <input name="note" placeholder="Anotá qué te dijo" maxLength={2000} className={inputClass} />
      </label>
      <button disabled={pending} className={smallButtonClass}>
        Anotar
      </button>
      {state && !state.ok && <p className="text-xs text-red-700">{state.message}</p>}
    </form>
  );
}
