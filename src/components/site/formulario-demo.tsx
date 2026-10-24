"use client";

import { useActionState } from "react";
import { pedirDemo, type EstadoLead } from "@/app/(marketing)/pedi-una-demo/actions";
import { ESPECIALIDADES } from "@/content/especialidades";

const input =
  "mt-1.5 w-full rounded-lg border border-brand-950/12 bg-white px-3.5 py-2.5 text-sm text-brand-950 outline-none placeholder:text-brand-950/35 focus:border-brand-500 focus:ring-2 focus:ring-brand-100";

export function FormularioDemo({ origen, compacto = false }: { origen: string; compacto?: boolean }) {
  const [estado, enviar, enviando] = useActionState<EstadoLead | undefined, FormData>(pedirDemo, undefined);

  if (estado?.ok)
    return (
      <div className="rounded-2xl bg-white p-8 text-center shadow-[0_20px_50px_rgb(8_24_63/0.12)] ring-1 ring-brand-950/5" role="status">
        <span className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-emerald/15 text-2xl text-emerald-700">✓</span>
        <h2 className="mt-4 text-xl font-medium text-brand-950">¡Gracias! Recibimos tu pedido.</h2>
        <p className="mt-2 text-sm text-tinta">Te vamos a escribir para coordinar la demo.</p>
      </div>
    );

  return (
    <form action={enviar} className="rounded-2xl bg-white p-6 text-left shadow-[0_20px_50px_rgb(8_24_63/0.12)] ring-1 ring-brand-950/5 sm:p-8">
      <h2 className="text-xl font-medium tracking-tight text-brand-950">Pedí una demo</h2>
      <input type="hidden" name="origen" value={origen} />
      <div className="absolute -left-[9999px]" aria-hidden="true">
        <label>
          No completar <input name="empresa_web" tabIndex={-1} autoComplete="off" />
        </label>
      </div>
      <div className={`mt-5 grid gap-4 ${compacto ? "" : "sm:grid-cols-2"}`}>
        <label className="text-sm font-medium text-brand-950">
          Nombre y apellido
          <input name="nombre" required autoComplete="name" className={input} placeholder="Laura Gómez" />
        </label>
        <label className="text-sm font-medium text-brand-950">
          Email de trabajo
          <input name="email" type="email" required autoComplete="email" className={input} placeholder="laura@clinica.com.ar" />
        </label>
        <label className="text-sm font-medium text-brand-950">
          WhatsApp
          <input name="telefono" type="tel" autoComplete="tel" className={input} placeholder="11 5555-0000" />
        </label>
        <label className="text-sm font-medium text-brand-950">
          Clínica o consultorio
          <input name="organizacion" autoComplete="organization" className={input} placeholder="Centro Médico Plaza" />
        </label>
        {!compacto && (
          <>
            <label className="text-sm font-medium text-brand-950">
              Especialidad principal
              <select name="especialidad" className={input} defaultValue="">
                <option value="">Elegí una</option>
                {ESPECIALIDADES.map((e) => (
                  <option key={e.slug}>{e.nombre}</option>
                ))}
                <option>Multiespecialidad</option>
              </select>
            </label>
            <label className="text-sm font-medium text-brand-950">
              Cantidad de profesionales
              <select name="tamano" className={input} defaultValue="">
                <option value="">Elegí una opción</option>
                <option>1 a 3</option>
                <option>4 a 10</option>
                <option>11 a 50</option>
                <option>Más de 50</option>
              </select>
            </label>
            <label className="text-sm font-medium text-brand-950 sm:col-span-2">
              ¿Qué te gustaría resolver?
              <textarea name="mensaje" rows={3} className={input} placeholder="Ej.: no damos abasto con el WhatsApp y tenemos muchos ausentes." />
            </label>
          </>
        )}
      </div>
      {estado?.error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          {estado.error}
        </p>
      )}
      <button
        type="submit"
        disabled={enviando}
        className="mt-6 w-full rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
      >
        {enviando ? "Enviando…" : "Quiero mi demo"}
      </button>
      <p className="mt-3 text-center text-xs text-tinta">
        Usamos tus datos solo para contactarte por la demo. Ver{" "}
        <a href="/privacidad" className="underline">
          privacidad
        </a>
        .
      </p>
    </form>
  );
}
