"use client";
import { useActionState, useEffect } from "react";
import { submitKeepingValues } from "@/components/keep-form";
import { useRouter } from "next/navigation";
import { createClinic, launchProfile, refreshClinic, applyImport, deleteClinic, deleteTemporaryDemos } from "../../clinics-actions";
import { buttonClass, dangerButtonClass, inputClass, Field, secondaryButtonClass } from "@/components/ui";

export function DeleteClinicButton({ clinicId, name }: { clinicId: string; name: string }) {
  return <form action={deleteClinic} onSubmit={(e) => {
    if (!confirm(`¿Borrar la ficha «${name}»? Se eliminan su agenda de prueba, pacientes, conversaciones y lecturas. No se puede deshacer.`)) e.preventDefault();
  }}>
    <input type="hidden" name="clinic_id" value={clinicId} />
    <button className={dangerButtonClass}>Borrar ficha</button>
  </form>;
}

export function DeleteTemporaryDemosButton({ count }: { count: number }) {
  return <form action={deleteTemporaryDemos} onSubmit={(e) => {
    if (!confirm(`¿Borrar ${count === 1 ? "la demo temporal" : `las ${count} demos temporales`}? Las demos conservadas y la clínica principal quedan.`)) e.preventDefault();
  }}>
    <button disabled={!count} className={dangerButtonClass}>Borrar demos temporales ({count})</button>
  </form>;
}

export function NewClinicForm() {
  const [state, action, pending] = useActionState(createClinic, {});
  return <form onSubmit={submitKeepingValues(action)} className="grid gap-3 sm:grid-cols-2">
    <Field label="Nombre de la nueva clínica"><input name="name" required maxLength={120} className={inputClass} /></Field>
    <Field label="Especialidad principal"><input name="specialty" placeholder="Odontología" maxLength={80} className={inputClass} /></Field>
    <Field label="Web (opcional)"><input name="website" placeholder="https://miclinica.com.ar" className={inputClass} /></Field>
    <div className="self-end"><button disabled={pending} className={buttonClass}>{pending ? "Creando…" : "Crear perfil"}</button></div>
    <p className="text-xs text-brand-900/60 sm:col-span-2">Se conserva desde el inicio y usa agenda de prueba. Después podés completar todos sus datos o leer su web.</p>
    {state.message && <p role="status" className="text-sm text-red-700 sm:col-span-2">{state.message}</p>}
  </form>;
}

export function ProfileTest({ clinicId }: { clinicId: string }) {
  const [state, action, pending] = useActionState(launchProfile, {});
  return <form action={action} className="space-y-2">
    <input type="hidden" name="clinic_id" value={clinicId} />
    <button disabled={pending} className={buttonClass}>{pending ? "Preparando…" : "Probar este perfil"}</button>
    {state.message && <p role="status" className={`text-sm ${state.ok ? "text-brand-800" : "text-red-700"}`}>{state.message}</p>}
    {state.url && <a href={state.url} target="_blank" rel="noreferrer" className={`${secondaryButtonClass} inline-flex`}>Abrir la prueba en el canal habilitado ↗</a>}
  </form>;
}

export function ReadWebsite({ clinicId, reading, hasWebsite }: { clinicId: string; reading: boolean; hasWebsite: boolean }) {
  const [state, action, pending] = useActionState(refreshClinic, {});
  const router = useRouter();
  useEffect(() => {
    if (!reading) return;
    const timer = setInterval(() => router.refresh(), 5000);
    const timeout = setTimeout(() => clearInterval(timer), 240000);
    return () => { clearInterval(timer); clearTimeout(timeout); };
  }, [reading, router]);
  return <div className="space-y-2">
    <form action={action}>
      <input type="hidden" name="clinic_id" value={clinicId} />
      <button disabled={!hasWebsite || pending || reading} className={buttonClass}>{reading || pending ? "Leyendo la web…" : "Leer web y revisar propuesta"}</button>
    </form>
    <p className="text-xs text-brand-900/60">La lectura prepara una propuesta y guarda el texto de sus páginas. Tus datos actuales se conservan hasta que elijas qué aplicar.</p>
    {!hasWebsite && <p className="text-sm text-brand-800">Primero guardá la web en <a href="/panel/configuracion#datos" className="underline">Reglas del consultorio</a>.</p>}
    {state.message && (!state.ok || reading || pending) && <p role="status" className={`text-sm ${state.ok ? "text-brand-800" : "text-red-700"}`}>{state.message}</p>}
    {reading && <button type="button" onClick={() => router.refresh()} className={secondaryButtonClass}>Actualizar estado</button>}
  </div>;
}

export function ImportReview({ clinicId, importId, revision, rows, catalog }: {
  clinicId: string; importId: string; revision: number;
  rows: Array<{ key: string; label: string; current: string; proposed: string }>;
  catalog: string;
}) {
  const [state, action, pending] = useActionState(applyImport, {});
  return <form onSubmit={submitKeepingValues(action)} className="space-y-3">
    <input type="hidden" name="clinic_id" value={clinicId} /><input type="hidden" name="import_id" value={importId} /><input type="hidden" name="revision" value={revision} />
    <p className="text-sm text-brand-900/70">Marcá solo los datos que querés aplicar. Urgencias, instrucciones adicionales, formas de pago y conexiones se conservan.</p>
    {rows.map((row) => <label key={row.key} className="block rounded-xl border border-brand-900/10 p-3 text-sm">
      <span className="flex items-center gap-2 font-medium"><input type="checkbox" name="fields" value={row.key} />{row.label}</span>
      <span className="mt-2 grid gap-3 sm:grid-cols-2">
        <span><span className="block text-xs font-semibold text-brand-900/65">ACTUAL</span><span className="whitespace-pre-wrap break-words">{row.current || "Sin dato"}</span></span>
        <span><span className="block text-xs font-semibold text-brand-900/65">LEÍDO DE LA WEB</span><span className="whitespace-pre-wrap break-words">{row.proposed || "Sin dato"}</span></span>
      </span>
    </label>)}
    <label className="block rounded-xl border border-brand-900/10 p-3 text-sm">
      <span className="flex items-center gap-2 font-medium"><input type="checkbox" name="fields" value="catalog" />Reemplazar catálogo y horarios activos</span>
      <span className="mt-2 block whitespace-pre-wrap">{catalog}</span>
      <span className="mt-2 block text-xs text-brand-900/60">Los profesionales y prestaciones anteriores quedan inactivos; sus turnos e historial se conservan. Los horarios no publicados son de prueba.</span>
    </label>
    <button disabled={pending} className={buttonClass}>{pending ? "Aplicando…" : "Aplicar únicamente lo seleccionado"}</button>
    {state.message && <p role="status" className={`text-sm ${state.ok ? "text-green-700" : "text-red-700"}`}>{state.message}</p>}
  </form>;
}
