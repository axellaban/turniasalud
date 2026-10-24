import Image from "next/image";
import Link from "next/link";
import { getConversacion } from "@/content/conversaciones";
import type { Producto } from "@/content/productos";
import { Flecha, Icono } from "./iconos";
import { ReproductorDemo } from "./reproductor-demo";
import { Eyebrow, Titulo } from "./secciones";

// Plantilla de las páginas de producto (/recepcion, /activa, /plataforma),
// con la misma secuencia de bloques que /concierge de Assort.

type LineaMock = { quien: "agente" | "paciente" | "sistema"; texto: string };

export function MockConversacion({ lineas, className = "" }: { lineas: LineaMock[]; className?: string }) {
  return (
    <div className={`space-y-2.5 rounded-2xl bg-white p-4 shadow-[0_20px_50px_rgb(8_24_63/0.12)] ring-1 ring-brand-950/5 ${className}`}>
      {lineas.map((l, i) =>
        l.quien === "sistema" ? (
          <p key={i} className="flex items-center gap-2 rounded-lg bg-brand-50 px-3 py-2 text-xs font-medium text-brand-700">
            <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-brand-600" /> {l.texto}
          </p>
        ) : (
          <div key={i} className={`flex ${l.quien === "agente" ? "justify-start" : "justify-end"}`}>
            <p
              className={`max-w-[85%] rounded-2xl px-3.5 py-2 text-[13px] leading-snug ${
                l.quien === "agente" ? "rounded-tl-sm bg-brand-600 text-white" : "rounded-tr-sm bg-[#eef1f7] text-brand-950"
              }`}
            >
              {l.texto}
            </p>
          </div>
        ),
      )}
    </div>
  );
}

export function PaginaProducto({ p }: { p: Producto }) {
  const demo = p.demo ? getConversacion(p.demo) : undefined;
  return (
    <>
      {/* Hero */}
      <section className="bg-gradient-to-b from-[#eef2ff] to-white pb-16 pt-16 sm:pt-20">
        <div className="mx-auto max-w-[1100px] px-4 text-center sm:px-6">
          <Eyebrow>{p.eyebrow}</Eyebrow>
          <h1 className="mx-auto mt-4 max-w-4xl text-[40px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[60px]">
            {p.titulo[0]} <span className="text-brand-600">{p.titulo[1]}</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-tinta">{p.bajada}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/pedi-una-demo" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700">
              Pedí una demo <Flecha />
            </Link>
            <Link href={demo ? "#escuchar" : "/demo"} className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
              Escuchalo en acción
            </Link>
          </div>
        </div>
        <div className="relative mx-auto mt-14 max-w-[1100px] px-4 sm:px-6">
          <div className="relative aspect-[16/8] overflow-hidden rounded-3xl">
            <Image src={p.imagen} alt="" fill sizes="(min-width: 1100px) 1100px, 100vw" className="object-cover" priority />
            <div className="absolute inset-0 bg-gradient-to-r from-brand-950/10 to-brand-950/40" />
          </div>
          <MockConversacion
            lineas={p.chat}
            className="relative -mt-24 ml-auto mr-2 max-w-sm sm:absolute sm:bottom-8 sm:right-12 sm:mt-0"
          />
        </div>
      </section>

      {/* El problema */}
      <section className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6">
        <Titulo linea1={p.problema.titulo[0]} linea2={p.problema.titulo[1]} bajada={p.problema.bajada} />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {p.problema.items.map((x, i) => (
            <article
              key={x.t}
              className={`rounded-2xl bg-gradient-to-b px-6 py-8 text-center ${
                ["from-[#e4f7f1] to-[#d1eee5]", "from-[#ecebff] to-[#dcdaf8]", "from-[#fff3e2] to-[#ffe2bd]"][i % 3]
              }`}
            >
              <h3 className="font-semibold text-brand-950">{x.t}</h3>
              <span className="mx-auto my-6 grid h-16 w-16 place-items-center rounded-full bg-white/70 text-brand-950/70">
                <Icono nombre={x.i} className="h-8 w-8" />
              </span>
              <p className="text-sm leading-relaxed text-brand-950/70">{x.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Presentación con tres pilares */}
      <section className="mx-auto max-w-[1100px] px-4 pb-20 sm:px-6">
        <Eyebrow className="text-center text-sun-700">{p.presentacion.eyebrow}</Eyebrow>
        <Titulo className="mt-3" linea1={p.presentacion.titulo[0]} linea2={p.presentacion.titulo[1]} bajada={p.presentacion.bajada} />
        <div className="mt-12 grid gap-4 md:grid-cols-3">
          {p.presentacion.pilares.map((x, i) => (
            // Texto oscuro sobre verde y naranja: el blanco no llega a 4,5:1.
            <article key={x.t} className={`rounded-2xl p-7 ${["bg-emerald text-brand-950", "bg-brand-600 text-white", "bg-sun-500 text-brand-950"][i % 3]}`}>
              <h3 className="text-2xl font-medium tracking-tight">{x.t}</h3>
              <p className="mt-10 text-[15px] leading-relaxed opacity-90">{x.d}</p>
            </article>
          ))}
        </div>
      </section>

      {/* Datos */}
      <section className="bg-[#f2f5ff] py-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
          <Eyebrow className="text-center">{p.datos.eyebrow}</Eyebrow>
          <Titulo className="mt-3" linea1={p.datos.titulo[0]} linea2={p.datos.titulo[1]} bajada={p.datos.bajada} />
          <dl className="mt-12 grid gap-8 text-center sm:grid-cols-3">
            {p.datos.items.map((x) => (
              <div key={x.d}>
                <dt className="text-6xl font-medium tracking-tight text-brand-600">{x.v}</dt>
                <dd className="mx-auto mt-3 max-w-[16rem] text-sm text-tinta">{x.d}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* Demo de audio */}
      {demo && (
        <section id="escuchar" className="mx-auto max-w-[1100px] scroll-mt-28 px-4 pt-20 sm:px-6">
          <Titulo linea1="Del primer mensaje a la confirmación," linea2="Turnia lo resuelve" bajada="Escuchá una conversación completa: turno y receta en la misma llamada." />
          <div className="mt-10">
            <ReproductorDemo conversacion={demo} variante="orbe" />
          </div>
        </section>
      )}

      {/* Secciones alternadas */}
      <section className="mx-auto max-w-[1100px] space-y-24 px-4 py-24 sm:px-6">
        {p.secciones.map((s, i) => (
          <div key={s.titulo} className="grid items-center gap-10 md:grid-cols-2">
            <div className={i % 2 ? "md:order-2" : ""}>
              <Eyebrow>{s.eyebrow}</Eyebrow>
              <h3 className="mt-3 text-[28px] font-medium leading-tight tracking-tight text-brand-950 sm:text-[34px]">{s.titulo}</h3>
              <p className="mt-4 leading-relaxed text-tinta">{s.texto}</p>
              <ul className="mt-6 space-y-3">
                {s.bullets.map((b) => (
                  <li key={b} className="flex gap-3 text-sm text-brand-950">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600">
                      <svg viewBox="0 0 16 16" className="h-3 w-3" fill="none" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                        <path d="M3.5 8.5l3 3 6-7" />
                      </svg>
                    </span>
                    {b}
                  </li>
                ))}
              </ul>
              <Link href={s.href} className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 hover:text-brand-700">
                {s.enlace} <Flecha />
              </Link>
            </div>
            <div className={`rounded-3xl bg-gradient-to-br from-[#eef2ff] to-[#e4f7f1] p-6 sm:p-10 ${i % 2 ? "md:order-1" : ""}`}>
              <MockConversacion lineas={s.mock} />
            </div>
          </div>
        ))}
      </section>

      {/* Canales */}
      <section className="bg-[#f7f9ff] py-20">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
          <Titulo linea1={p.canales.titulo[0]} linea2={p.canales.titulo[1]} bajada={p.canales.bajada} />
          <div className="mt-12 grid gap-4 md:grid-cols-3">
            {p.canales.items.map((c) => (
              <article key={c.t} className="rounded-2xl bg-white p-7 ring-1 ring-brand-950/5">
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Icono nombre={c.i} className="h-6 w-6" />
                </span>
                <h3 className="mt-5 font-semibold text-brand-950">{c.t}</h3>
                <p className="mt-2 text-sm leading-relaxed text-tinta">{c.d}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Cómo funciona */}
      <section className="mx-auto max-w-[900px] px-4 py-24 sm:px-6">
        <Eyebrow className="text-center">Cómo funciona</Eyebrow>
        <Titulo className="mt-3" linea1={p.pasos.titulo[0]} linea2={p.pasos.titulo[1]} bajada={p.pasos.bajada} />
        <ol className="relative mx-auto mt-14 max-w-xl space-y-10 border-l border-brand-200 pl-8">
          {p.pasos.items.map((x, i) => (
            <li key={x.t} className="relative">
              <span className="absolute -left-[45px] grid h-7 w-7 place-items-center rounded-full bg-brand-600 text-xs font-semibold text-white ring-4 ring-white">
                {i + 1}
              </span>
              <h3 className="font-semibold text-brand-950">{x.t}</h3>
              <p className="mt-1 text-sm leading-relaxed text-tinta">{x.d}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* CTA */}
      <section className="mx-auto max-w-[1100px] px-4 pb-20 sm:px-6">
        <div className="rounded-3xl bg-gradient-to-br from-brand-600 to-brand-800 px-6 py-14 text-center text-white">
          <h2 className="mx-auto max-w-2xl text-3xl font-medium tracking-tight sm:text-[40px] sm:leading-tight">{p.cta.titulo}</h2>
          <p className="mx-auto mt-4 max-w-lg text-brand-100">{p.cta.bajada}</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/pedi-una-demo" className="rounded-lg bg-white px-5 py-3 text-sm font-medium text-brand-700 hover:bg-brand-50">
              Pedí una demo
            </Link>
            <Link href="/escucha-a-nuestros-agentes" className="rounded-lg px-5 py-3 text-sm font-medium text-white ring-1 ring-white/40 hover:bg-white/10">
              Escuchá a nuestros agentes
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
