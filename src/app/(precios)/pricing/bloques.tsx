import type { ReactNode } from "react";
import { Icono } from "@/components/site/iconos";

// Bloques que comparten /pricing y /pricing/consultorio.

type Garantia = { plazo: string; titulo: string; texto: string };

export function Garantias({ titulo, items }: { titulo: ReactNode; items: Garantia[] }) {
  return (
    <section className="bg-[#f5f7fd] py-24">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
        <div className="mx-auto max-w-2xl text-center">
          <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-950/5">
            <Icono nombre="escudo" className="h-6 w-6" />
          </span>
          <h2 className="mt-5 text-[32px] font-medium leading-[1.12] tracking-tight text-brand-950 sm:text-[44px]">{titulo}</h2>
          <p className="mt-4 text-[17px] leading-relaxed text-tinta">Si no cumplimos, lo pagamos nosotros.</p>
        </div>
        <ol className={`mx-auto mt-14 grid gap-5 ${items.length === 2 ? "max-w-[780px] md:grid-cols-2" : "md:grid-cols-3"}`}>
          {items.map((g, i) => (
            <li key={g.titulo} className="rounded-3xl bg-white p-7 shadow-[0_6px_24px_rgb(8_24_63/0.05)] ring-1 ring-brand-950/8 sm:p-8">
              <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-950/40">Garantía {i + 1}</span>
              <p className="mt-3 text-[34px] font-medium leading-none tracking-tight text-brand-600 tabular-nums">{g.plazo}</p>
              <h3 className="mt-5 font-semibold text-brand-950">{g.titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-tinta">{g.texto}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

/** Lo que pide el Programa Fundadores: a la vista, junto al formulario, y no en la letra chica. */
export function RequisitoFundador({ items }: { items: string[] }) {
  return (
    <div className="mt-7 max-w-lg rounded-2xl bg-white/[0.06] p-5 ring-1 ring-white/10">
      <p className="text-sm font-semibold text-white">A cambio del precio congelado, te pedimos:</p>
      <ul className="mt-3 flex flex-wrap gap-2">
        {items.map((r) => (
          <li key={r} className="rounded-full bg-white/10 px-3 py-1.5 text-sm text-white/85">
            {r}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function LetraChica({ items }: { items: Array<{ titulo: string; texto: string }> }) {
  return (
    <dl className="space-y-6 border-t border-white/10 pt-8 lg:mt-10">
      {items.map((l) => (
        <div key={l.titulo} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-6">
          <dt className="text-sm font-semibold text-white">{l.titulo}</dt>
          <dd className="text-sm leading-relaxed text-white/60">{l.texto}</dd>
        </div>
      ))}
    </dl>
  );
}
