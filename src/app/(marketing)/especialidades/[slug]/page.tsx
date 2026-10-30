import type { Metadata } from "next";
import Link from "next/link";
import { cta } from "@/lib/analytics-shared";
import { notFound } from "next/navigation";
import { Flecha, Icono } from "@/components/site/iconos";
import { MockConversacion } from "@/components/site/producto";
import { ReproductorDemo } from "@/components/site/reproductor-demo";
import { BandaProbalo, Eyebrow, PreguntasFrecuentes, TarjetasGradiente, Titulo } from "@/components/site/secciones";
import { getConversacion } from "@/content/conversaciones";
import { ESPECIALIDADES, getEspecialidad } from "@/content/especialidades";

// Plantilla de especialidad, como /dermatology de Assort: hero, flujos propios,
// demo de audio y preguntas frecuentes.

export const dynamicParams = false;

export function generateStaticParams() {
  return ESPECIALIDADES.map((e) => ({ slug: e.slug }));
}

export async function generateMetadata({ params }: PageProps<"/especialidades/[slug]">): Promise<Metadata> {
  const esp = getEspecialidad((await params).slug);
  return esp ? { title: esp.nombre, description: esp.bajada } : {};
}

export default async function EspecialidadPage({ params }: PageProps<"/especialidades/[slug]">) {
  const esp = getEspecialidad((await params).slug);
  if (!esp) notFound();
  const demo = esp.demo ? getConversacion(esp.demo) : undefined;
  const otras = ESPECIALIDADES.filter((e) => e.slug !== esp.slug);
  return (
    <>
      <section className="bg-gradient-to-b from-[#eef2ff] to-white">
        <div className="mx-auto grid max-w-[1100px] items-center gap-12 px-4 pb-20 pt-16 sm:px-6 md:grid-cols-[1.15fr_1fr] md:pt-20">
          <div>
            <span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-brand-600 text-white shadow-sm">
              <Icono nombre={esp.icono} className="h-6 w-6" />
            </span>
            <Eyebrow className="mt-6">{esp.eyebrow}</Eyebrow>
            <h1 className="mt-3 text-[40px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[54px]">{esp.titulo}</h1>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-tinta">{esp.bajada}</p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/pedi-una-demo" {...cta("guided_demo", "specialty_hero", "pedi_una_demo")} className="inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700">
                Pedí una demo <Flecha />
              </Link>
              {demo && (
                <Link href="#escuchar" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-medium text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                  Escuchar la demo
                </Link>
              )}
            </div>
          </div>
          <div className="rounded-3xl bg-gradient-to-br from-[#dfe7ff] to-[#e4f7f1] p-6 sm:p-10">
            <MockConversacion
              lineas={[
                { quien: "paciente", texto: esp.ejemplo.paciente },
                { quien: "agente", texto: esp.ejemplo.agente },
              ]}
            />
          </div>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6">
        <Titulo linea1={`Flujos de ${esp.nombre.toLowerCase()}`} linea2="resueltos de punta a punta" />
        <div className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {esp.flujos.map((f) => (
            <article key={f.titulo} className="rounded-2xl bg-white p-6 shadow-[0_6px_24px_rgb(8_24_63/0.05)] ring-1 ring-brand-950/8">
              <h3 className="font-semibold text-brand-950">{f.titulo}</h3>
              <p className="mt-2 text-sm leading-relaxed text-tinta">{f.texto}</p>
            </article>
          ))}
        </div>
      </section>

      {demo && (
        <section id="escuchar" className="mx-auto max-w-[1100px] scroll-mt-28 px-4 pb-20 sm:px-6">
          <Titulo linea1="Escuchá a Turnia atendiendo" linea2={esp.nombre.toLowerCase()} />
          <div className="mt-10">
            <ReproductorDemo conversacion={demo} variante="orbe" />
          </div>
        </section>
      )}

      <section className="mx-auto max-w-[1100px] px-4 pb-4 sm:px-6">
        <TarjetasGradiente />
      </section>
      <div className="pt-16">
        <BandaProbalo />
      </div>
      <PreguntasFrecuentes faqs={esp.faqs} />

      <section className="mx-auto max-w-[1100px] px-4 pb-20 sm:px-6">
        <p className="text-center text-sm font-semibold text-brand-950">Otras especialidades</p>
        <ul className="mt-5 flex flex-wrap justify-center gap-2">
          {otras.map((e) => (
            <li key={e.slug}>
              <Link href={`/especialidades/${e.slug}`} className="inline-flex items-center gap-1.5 rounded-full bg-brand-50 px-3.5 py-1.5 text-sm text-brand-700 hover:bg-brand-100">
                <Icono nombre={e.icono} className="h-4 w-4" /> {e.nombre}
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
