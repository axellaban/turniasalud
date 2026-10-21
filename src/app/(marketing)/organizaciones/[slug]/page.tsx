import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FormularioDemo } from "@/components/site/formulario-demo";
import { Icono } from "@/components/site/iconos";
import { BandaProbalo, Eyebrow, GrillaBeneficios, PreguntasFrecuentes } from "@/components/site/secciones";
import { ORGANIZACIONES, getOrganizacion } from "@/content/organizaciones";

// Plantilla por tipo de organización, como /health-systems de Assort.

export const dynamicParams = false;

export function generateStaticParams() {
  return ORGANIZACIONES.map((o) => ({ slug: o.slug }));
}

export async function generateMetadata({ params }: PageProps<"/organizaciones/[slug]">): Promise<Metadata> {
  const org = getOrganizacion((await params).slug);
  return org ? { title: org.nombre, description: org.bajada } : {};
}

export default async function OrganizacionPage({ params }: PageProps<"/organizaciones/[slug]">) {
  const org = getOrganizacion((await params).slug);
  if (!org) notFound();
  return (
    <>
      <section className="bg-gradient-to-b from-[#eef2ff] to-white">
        <div className="mx-auto grid max-w-[1100px] items-center gap-12 px-4 pb-20 pt-16 sm:px-6 md:grid-cols-[1.1fr_1fr] md:pt-20">
          <div>
            <span className="inline-grid h-12 w-12 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-950/5">
              <Icono nombre={org.icono} className="h-6 w-6" />
            </span>
            <Eyebrow className="mt-6">{org.eyebrow}</Eyebrow>
            <h1 className="mt-3 text-[40px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[54px]">{org.titulo}</h1>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-tinta">{org.bajada}</p>
            <ul className="mt-8 flex flex-wrap gap-2">
              {ORGANIZACIONES.filter((o) => o.slug !== org.slug).map((o) => (
                <li key={o.slug}>
                  <Link href={`/organizaciones/${o.slug}`} className="rounded-full bg-white px-3.5 py-1.5 text-sm text-brand-700 ring-1 ring-brand-200 hover:bg-brand-50">
                    {o.nombre}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <FormularioDemo origen={`/organizaciones/${org.slug}`} compacto />
        </div>
      </section>
      <section className="mx-auto max-w-[1100px] space-y-20 px-4 py-20 sm:px-6">
        {org.bloques.map((b) => (
          <GrillaBeneficios key={b.titulo} titulo={b.titulo} items={b.items} />
        ))}
      </section>
      <BandaProbalo />
      <PreguntasFrecuentes faqs={org.faqs} />
    </>
  );
}
