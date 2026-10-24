import type { Metadata } from "next";
import Link from "next/link";
import { Flecha, Icono } from "@/components/site/iconos";
import { BandaProbalo } from "@/components/site/secciones";
import { ESPECIALIDADES } from "@/content/especialidades";
import { ORGANIZACIONES } from "@/content/organizaciones";

export const metadata: Metadata = {
  title: "Especialidades",
  description: "Turnia se adapta a cada especialidad: tipos de turno, indicaciones previas, coberturas y derivaciones de cada consultorio.",
};

// Índice de especialidades: al que lleva «Ver todas las especialidades» de la home.
export default function EspecialidadesPage() {
  return (
    <>
      <section className="bg-gradient-to-b from-[#eef2ff] to-white">
        <div className="mx-auto max-w-[1100px] px-4 pb-14 pt-16 text-center sm:px-6 md:pt-20">
          <h1 className="mx-auto max-w-3xl text-[40px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[54px]">
            Una recepcionista que conoce <span className="text-brand-600">tu especialidad</span>
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-[17px] leading-relaxed text-tinta">
            Cada especialidad trae sus tipos de turno, sus indicaciones previas y sus derivaciones. Elegí la tuya para ver cómo la atiende
            Turnia.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-[1100px] px-4 pb-20 sm:px-6">
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ESPECIALIDADES.map((e) => (
            <li key={e.slug}>
              <Link
                href={`/especialidades/${e.slug}`}
                className="group flex h-full flex-col rounded-2xl bg-white p-6 ring-1 ring-brand-950/8 shadow-[0_6px_24px_rgb(8_24_63/0.05)] hover:ring-brand-600"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Icono nombre={e.icono} className="h-5 w-5" />
                </span>
                <span className="mt-4 text-lg font-semibold tracking-tight text-brand-950">{e.nombre}</span>
                <span className="mt-2 line-clamp-3 flex-1 text-sm leading-relaxed text-tinta">{e.bajada}</span>
                <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-brand-600 group-hover:text-brand-700">
                  Ver {e.nombre.toLowerCase()} <Flecha />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <h2 className="mt-16 text-center text-2xl font-medium tracking-tight text-brand-950">También para cada tipo de centro</h2>
        <ul className="mx-auto mt-6 flex max-w-3xl flex-wrap justify-center gap-3">
          {ORGANIZACIONES.map((o) => (
            <li key={o.slug}>
              <Link href={`/organizaciones/${o.slug}`} className="inline-flex items-center gap-2 rounded-full bg-brand-50 px-4 py-2 text-sm font-medium text-brand-700 hover:bg-brand-100">
                <Icono nombre={o.icono} className="h-4 w-4" /> {o.nombre}
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="pb-8">
        <BandaProbalo />
      </div>
    </>
  );
}
