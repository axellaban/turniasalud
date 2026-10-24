"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { CAPACIDADES } from "@/content/site";
import type { IconoClave } from "@/content/tipos";
import { Flecha, Icono } from "./iconos";

/** Rota un índice cada `ms` milisegundos, salvo que el usuario prefiera menos movimiento o esté pausado. */
function useRotacion(total: number, ms: number, pausado = false) {
  const [i, setI] = useState(0);
  useEffect(() => {
    if (pausado || total < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const t = setInterval(() => setI((x) => (x + 1) % total), ms);
    return () => clearInterval(t);
  }, [total, ms, pausado]);
  return [i, setI] as const;
}

// ── Carrusel "lo que medís" (en lugar de los testimonios con métricas de Assort) ─────────

export type Destacado = { pestana: string; icono: IconoClave; situacion: string; resolucion: string; valor: string; etiqueta: string; href: string };

export function CarruselDestacados({ items }: { items: Destacado[] }) {
  const [pausado, setPausado] = useState(false);
  const [i, setI] = useRotacion(items.length, 7000, pausado);
  const d = items[i];
  return (
    <section
      className="bg-[#f2f5ff] py-20 sm:py-24"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
        <div key={i} className="animar-aparecer grid items-center gap-10 md:grid-cols-[1.4fr_1fr]">
          <div className="flex gap-5">
            <span className="select-none text-7xl font-semibold leading-none text-emerald/40" aria-hidden="true">
              “
            </span>
            <div>
              <p className="text-lg leading-relaxed text-brand-950 sm:text-xl">{d.situacion}</p>
              <div className="mt-6 flex items-start gap-3">
                <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-brand-600 text-white">
                  <Icono nombre={d.icono} className="h-6 w-6" />
                </span>
                <span>
                  <span className="block text-sm font-semibold text-brand-950">Con Turnia</span>
                  <span className="block text-sm leading-relaxed text-tinta">{d.resolucion}</span>
                </span>
              </div>
            </div>
          </div>
          <div className="border-brand-950/10 md:border-l md:pl-10">
            <p className="text-6xl font-medium tracking-tight text-brand-600 sm:text-7xl">{d.valor}</p>
            <p className="mt-2 text-brand-950">{d.etiqueta}</p>
            <Link href={d.href} className="mt-6 inline-flex items-center gap-1.5 border-t border-brand-950/10 pt-4 text-sm font-medium text-brand-600 hover:text-brand-700">
              Ver cómo funciona <Flecha />
            </Link>
          </div>
        </div>
        <div className="mt-14 grid grid-cols-2 gap-3 sm:grid-cols-4" role="tablist" aria-label="Destacados">
          {items.map((x, j) => (
            <button
              key={x.pestana}
              type="button"
              role="tab"
              aria-selected={i === j}
              onClick={() => setI(j)}
              className="group text-left"
            >
              <span className="block h-0.5 w-full overflow-hidden rounded bg-brand-950/10">
                <span className={`block h-full bg-brand-950 transition-[width] duration-500 ${i === j ? "w-full" : "w-0"}`} />
              </span>
              <span className={`mt-3 block text-sm font-medium ${i === j ? "text-brand-950" : "text-brand-950/65 group-hover:text-brand-950"}`}>
                {x.pestana}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

// ── Rueda vertical de capacidades ("Streamline Every Step of the Care Journey") ─────────

export function RuedaCapacidades() {
  const total = CAPACIDADES.length;
  const [pausado, setPausado] = useState(false);
  const [activo, setActivo] = useRotacion(total, 2200, pausado);
  const visibles = [-3, -2, -1, 0, 1, 2, 3].map((off) => ({ off, item: CAPACIDADES[(activo + off + total) % total], idx: (activo + off + total) % total }));
  const actual = CAPACIDADES[activo];

  return (
    <section
      className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6 sm:py-28"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <div className="grid items-center gap-8 md:grid-cols-[220px_1fr_200px]">
        <h2 className="text-2xl font-medium leading-tight tracking-tight text-brand-950">Simplificá cada paso del recorrido del paciente</h2>
        <ul className="relative flex flex-col items-center gap-1 py-2 text-center" aria-label="Capacidades de Turnia">
          {visibles.map(({ off, item, idx }) => {
            const dist = Math.abs(off);
            return (
              <li key={`${off}-${item.nombre}`} className={dist > 2 ? "hidden sm:block" : ""}>
                {/* Las de los bordes son el desvanecido de la rueda: se pueden tocar, pero no se leen ni se enfocan. */}
                <button
                  type="button"
                  onClick={() => setActivo(idx)}
                  aria-hidden={dist > 1 ? true : undefined}
                  tabIndex={dist > 1 ? -1 : undefined}
                  className="font-medium tracking-tight transition-[color,font-size] duration-500 hover:!text-brand-950"
                  style={{
                    fontSize: dist === 0 ? "clamp(1.9rem, 4vw, 2.6rem)" : dist === 1 ? "clamp(1.4rem, 3vw, 2rem)" : "clamp(1.2rem, 2.5vw, 1.7rem)",
                    color: dist === 0 ? "#171729" : `rgb(23 23 41 / ${dist === 1 ? 0.65 : dist === 2 ? 0.4 : 0.2})`,
                  }}
                  aria-current={dist === 0 ? "true" : undefined}
                >
                  {item.nombre}
                </button>
              </li>
            );
          })}
        </ul>
        <div className="flex md:justify-end">
          <Link href={actual.href} className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-5 py-3 text-sm font-medium text-brand-700 hover:bg-brand-100">
            Ver más <Flecha />
          </Link>
        </div>
      </div>
    </section>
  );
}

// ── Banda "veredicto" con frases rotativas ─────────────────────────────────────────────

export function BandaVeredicto({ frases }: { frases: string[] }) {
  const [pausado, setPausado] = useState(false);
  const [i, setI] = useRotacion(frases.length, 4000, pausado);
  return (
    <div
      className="flex flex-col items-center justify-center rounded-3xl bg-emerald px-6 py-14 text-center text-brand-950"
      onMouseEnter={() => setPausado(true)}
      onMouseLeave={() => setPausado(false)}
      onFocus={() => setPausado(true)}
      onBlur={() => setPausado(false)}
    >
      <span className="grid h-16 w-16 place-items-center rounded-2xl bg-white/30" aria-hidden="true">
        <Icono nombre="chat" className="h-9 w-9" />
      </span>
      <p className="mt-4 text-6xl font-medium tracking-tight sm:text-7xl">24/7</p>
      <p className="mt-2 text-2xl font-medium sm:text-3xl">Atención que nunca cierra</p>
      <p key={i} className="animar-aparecer mt-4 min-h-12 max-w-md text-brand-950/85">
        {frases[i]}
      </p>
      <div className="mt-2 flex" role="tablist" aria-label="Frases">
        {frases.map((f, j) => (
          <button
            key={f}
            type="button"
            role="tab"
            aria-selected={i === j}
            aria-label={`Frase ${j + 1}`}
            onClick={() => setI(j)}
            className="grid h-8 min-w-8 place-items-center rounded-full"
          >
            <span className={`h-2 rounded-full transition-[width,background-color] ${i === j ? "w-5 bg-brand-950" : "w-2 bg-brand-950/35"}`} />
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Carrusel de casos con foto grande y botón play ─────────────────────────────────────

export type Caso = { titulo: string; imagen: string; href: string; pestana: string; icono: IconoClave };

export function CarruselCasos({ casos }: { casos: Caso[] }) {
  const [i, setI] = useState(0);
  const total = casos.length;
  const prev = casos[(i - 1 + total) % total];
  const next = casos[(i + 1) % total];
  const c = casos[i];
  return (
    <section className="overflow-hidden py-20">
      <div className="relative mx-auto max-w-[1240px] px-4 sm:px-6">
        <div className="relative flex items-stretch justify-center gap-4">
          <button
            type="button"
            onClick={() => setI((i - 1 + total) % total)}
            className="relative hidden w-[18%] shrink-0 overflow-hidden rounded-2xl opacity-70 transition hover:opacity-90 md:block"
            aria-label={`Anterior: ${prev.titulo}`}
          >
            <Image src={prev.imagen} alt="" fill sizes="20vw" className="object-cover" />
          </button>
          <article key={i} className="animar-aparecer relative aspect-[4/5] w-full overflow-hidden rounded-2xl sm:aspect-[16/9] md:w-[64%]">
            <Image src={c.imagen} alt="" fill sizes="(min-width: 768px) 64vw, 100vw" className="object-cover" priority={false} />
            <div className="absolute inset-0 bg-gradient-to-t from-[#0b0d1a]/80 via-[#0b0d1a]/20 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 p-6 sm:p-10">
              <h3 className="max-w-md text-2xl font-medium leading-snug text-white sm:text-[28px]">{c.titulo}</h3>
              <Link
                href={c.href}
                className="mt-6 grid h-14 w-14 place-items-center rounded-full bg-white text-brand-600 shadow-lg transition hover:scale-105"
                style={{ animation: "turnia-pulso 2s infinite" }}
                aria-label={`Escuchar: ${c.titulo}`}
              >
                <svg viewBox="0 0 24 24" className="ml-1 h-6 w-6" fill="currentColor" aria-hidden="true">
                  <path d="M7 4.5v15l13-7.5z" />
                </svg>
              </Link>
            </div>
          </article>
          <button
            type="button"
            onClick={() => setI((i + 1) % total)}
            className="relative hidden w-[18%] shrink-0 overflow-hidden rounded-2xl opacity-70 transition hover:opacity-90 md:block"
            aria-label={`Siguiente: ${next.titulo}`}
          >
            <Image src={next.imagen} alt="" fill sizes="20vw" className="object-cover" />
          </button>
        </div>
        <div className="mx-auto mt-8 grid max-w-[64%] min-w-[300px] grid-cols-2 gap-4 sm:grid-cols-4" role="tablist" aria-label="Casos">
          {casos.map((x, j) => (
            <button key={x.pestana} type="button" role="tab" aria-selected={i === j} onClick={() => setI(j)} className="text-left">
              <span className={`block h-0.5 rounded ${i === j ? "bg-brand-950" : "bg-brand-950/10"}`} />
              <span className={`mt-3 flex items-center gap-2 text-sm ${i === j ? "text-brand-950" : "text-brand-950/65"}`}>
                <Icono nombre={x.icono} className="h-4 w-4" /> {x.pestana}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
