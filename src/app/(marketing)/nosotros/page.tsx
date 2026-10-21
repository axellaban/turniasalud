import type { Metadata } from "next";
import Link from "next/link";
import { Flecha, Icono } from "@/components/site/iconos";
import { Titulo } from "@/components/site/secciones";

export const metadata: Metadata = {
  title: "Nosotros",
  description: "Turnia Salud construye agentes de IA para que ningún paciente de Latinoamérica quede sin respuesta.",
};

const VALORES = [
  { t: "WhatsApp primero", d: "En Latinoamérica los pacientes escriben y mandan audios. Diseñamos para ese canal desde el primer día.", i: "whatsapp" as const },
  { t: "Seguridad clínica", d: "El agente nunca diagnostica. Ante una urgencia, deriva al 107 o a la guardia y avisa al equipo.", i: "escudo" as const },
  { t: "Datos que se cuidan", d: "Pensado para la Ley 25.326 de protección de datos personales: los datos de salud solo los ve tu clínica.", i: "memoria" as const },
  { t: "Para el equipo, no en su contra", d: "La IA hace lo repetitivo para que las personas atiendan a las personas.", i: "tareas" as const },
];

export default function NosotrosPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-[#eef2ff] to-white pb-20 pt-16 sm:pt-24">
        <div className="mx-auto max-w-[900px] px-4 text-center sm:px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Nosotros</p>
          <h1 className="mt-4 text-[40px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[60px]">
            Que ningún paciente <span className="text-brand-600">quede sin respuesta</span>
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-tinta">
            Turnia Salud nace en Argentina para resolver un problema de todos los días: clínicas que no llegan a contestar
            el WhatsApp ni el teléfono, y pacientes que se quedan sin turno. Construimos agentes de IA que atienden como la
            mejor recepcionista, a cualquier hora.
          </p>
        </div>
      </section>
      <section className="mx-auto max-w-[1100px] px-4 pb-20 sm:px-6">
        <Titulo linea1="Lo que nos guía" />
        <div className="mt-12 grid gap-4 sm:grid-cols-2">
          {VALORES.map((v) => (
            <article key={v.t} className="flex gap-5 rounded-2xl bg-white p-7 shadow-[0_6px_24px_rgb(8_24_63/0.05)] ring-1 ring-brand-950/8">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                <Icono nombre={v.i} className="h-6 w-6" />
              </span>
              <span>
                <h2 className="font-semibold text-brand-950">{v.t}</h2>
                <p className="mt-2 text-sm leading-relaxed text-tinta">{v.d}</p>
              </span>
            </article>
          ))}
        </div>
        <div className="mt-14 text-center">
          <Link href="/pedi-una-demo" className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700">
            Hablemos <Flecha />
          </Link>
        </div>
      </section>
    </>
  );
}
