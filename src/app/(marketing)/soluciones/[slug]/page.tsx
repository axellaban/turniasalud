import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioDemo } from "@/components/site/formulario-demo";
import { Flecha, Icono } from "@/components/site/iconos";
import { BandaProbalo, Eyebrow, GrillaBeneficios, PreguntasFrecuentes } from "@/components/site/secciones";
import { CASOS, getCaso } from "@/content/casos";

// Plantilla de caso de uso, como /patient-scheduling de Assort: hero con formulario,
// tres bloques de beneficios, "por qué Turnia" y preguntas frecuentes.

export const dynamicParams = false;

export function generateStaticParams() {
  return CASOS.map((c) => ({ slug: c.slug }));
}

export async function generateMetadata({ params }: PageProps<"/soluciones/[slug]">): Promise<Metadata> {
  const caso = getCaso((await params).slug);
  return caso ? { title: caso.nombre, description: caso.bajada } : {};
}

export default async function CasoPage({ params }: PageProps<"/soluciones/[slug]">) {
  const caso = getCaso((await params).slug);
  if (!caso) notFound();
  return (
    <>
      <section className="bg-gradient-to-b from-[#eef2ff] to-white">
        <div className="mx-auto grid max-w-[1100px] items-center gap-12 px-4 pb-20 pt-16 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-20">
          <div>
            <span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-950/5">
              <Icono nombre={caso.icono} className="h-6 w-6" />
            </span>
            <Eyebrow className="mt-6">{caso.eyebrow}</Eyebrow>
            <h1 className="mt-3 text-[40px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[54px]">{caso.titulo}</h1>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-tinta">{caso.bajada}</p>
            <p className="mt-8 text-xs font-semibold uppercase tracking-[0.14em] text-tinta">
              Pensado para clínicas de más de 18 especialidades
            </p>
          </div>
          <FormularioDemo origen={`/soluciones/${caso.slug}`} compacto />
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] space-y-20 px-4 py-20 sm:px-6">
        {caso.bloques.map((b) => (
          <GrillaBeneficios key={b.titulo} titulo={b.titulo} items={b.items} />
        ))}
      </section>

      <section className="bg-navy py-20 text-white">
        <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
          <p className="text-center text-xs font-semibold uppercase tracking-[0.14em] text-aqua">Por qué Turnia</p>
          <h2 className="mx-auto mt-3 max-w-3xl text-center text-[30px] font-medium leading-tight tracking-tight sm:text-[40px]">{caso.porque.titulo}</h2>
          <ul className="mt-12 grid gap-4 md:grid-cols-3">
            {caso.porque.items.map((x, i) => (
              <li key={x} className="rounded-2xl bg-white/5 p-6 ring-1 ring-white/10">
                <span className="text-sm font-semibold text-aqua">0{i + 1}</span>
                <p className="mt-3 leading-relaxed text-white/90">{x}</p>
              </li>
            ))}
          </ul>
          <div className="mt-10 text-center">
            <Link href="/plataforma" className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-5 py-3 text-sm font-medium hover:bg-white/15">
              Conocé la plataforma <Flecha />
            </Link>
          </div>
        </div>
      </section>

      <div className="pt-20">
        <BandaProbalo />
      </div>
      <PreguntasFrecuentes faqs={caso.faqs} />
    </>
  );
}
