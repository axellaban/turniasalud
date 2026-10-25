import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { demoStatus } from "@/lib/demo/config";
import { isConfigured } from "@/lib/env";
import { publicOutreach, type PublicOutreach } from "@/lib/sales/outreach";
import { ofBusiness, withArticle } from "@/lib/sales/outreach-messages";
import { EmpezarDemo } from "./empezar-demo";

// La demo de cada odontólogo de la prospección: llega por el link del mensaje de Axel.
export const dynamic = "force-dynamic";

/** «Dra. Myriam Moreta» si sabemos cómo se presenta; si no, su nombre. */
const profesional = (p: PublicOutreach) => (p.title ? `${p.title} ${p.name}` : p.name);
const consultorio = (p: PublicOutreach) => p.business_name || `Consultorio de ${p.name}`;

export async function generateMetadata({ params }: PageProps<"/p/[code]">): Promise<Metadata> {
  const p = await publicOutreach((await params).code);
  if (!p) return { title: "Demo de Turnia", robots: { index: false, follow: false } };
  const title = `Demo para ${consultorio(p)}`;
  const description = "Probá cómo Sofi atiende el WhatsApp de tu consultorio: contesta al instante, también a la noche y el fin de semana, y da los turnos.";
  return { title, description, robots: { index: false, follow: false }, openGraph: { title, description }, twitter: { title, description } };
}

export default async function DemoPersonalPage({ params, searchParams }: PageProps<"/p/[code]">) {
  const { code } = await params;
  const p = await publicOutreach(code);
  if (!p) notFound();
  // Axel la abre desde el panel para ver lo que recibe el odontólogo: no cuenta como visita.
  const contar = (await searchParams).vista !== "panel";
  const status = await demoStatus();
  const lista = status.base && isConfigured().elevenlabs;
  const datos = p.website
    ? { website: p.website }
    : { nombre: consultorio(p), direccion: [p.address, p.zone].filter(Boolean).join(", ") || null, especialidad: "Odontología", profesional: profesional(p) };

  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white">
      <div className="mx-auto max-w-[760px] px-4 pb-24 pt-16 text-center sm:px-6 md:pt-24">
        <p className="text-sm font-semibold uppercase tracking-wider text-brand-600">Demo para {consultorio(p)}</p>
        <h1 className="mx-auto mt-4 max-w-[680px] text-[34px] font-medium leading-[1.08] tracking-tight text-brand-950 sm:text-[50px]">
          Hola {p.greeting || p.name.split(" ")[0]}: así atendería Sofi <span className="text-brand-600">el WhatsApp de tu consultorio</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[560px] text-[17px] leading-relaxed text-tinta">
          Probala como si fueras un paciente: pedile un turno, preguntale algo o cancelá. Contesta al instante, también a la noche y el fin de semana, y
          da los turnos con {withArticle(p.title, p.name)}.
        </p>

        {lista ? (
          <EmpezarDemo code={p.code} datos={datos} contar={contar} />
        ) : (
          <p className="mx-auto mt-9 max-w-[520px] rounded-2xl bg-white p-5 text-sm text-tinta ring-1 ring-brand-950/5">
            La demo está pausada por unos minutos. Respondé el mensaje de WhatsApp y te la muestro yo.
          </p>
        )}
        <p className="mx-auto mt-4 max-w-[520px] text-sm text-tinta">
          Tarda unos segundos en prepararse. Es una prueba: los turnos que reserves no llegan a ningún paciente ni a tu agenda.
        </p>

        {/* Ejemplo ilustrativo, para saber qué esperar antes de tocar el botón. */}
        <figure className="mx-auto mt-12 max-w-[460px] rounded-2xl bg-[#f5f7fc] p-4 text-left ring-1 ring-brand-950/5">
          <figcaption className="mb-3 text-xs font-medium text-tinta">Ejemplo de una conversación</figcaption>
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-[15px] text-white">
            Hola, ¿tienen turno para una limpieza esta semana?
          </p>
          <p className="mt-2 w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[15px] text-brand-950 ring-1 ring-brand-950/5">
            ¡Hola! Soy Sofi, {ofBusiness(consultorio(p))}. Tengo el martes a las 10:30 o el jueves a las 16 con {withArticle(p.title, p.name)}. ¿Cuál te queda
            mejor?
          </p>
        </figure>

        <p className="mx-auto mt-10 max-w-[560px] text-sm leading-relaxed text-tinta">
          ¿Preferís que te la muestre? Respondé el mensaje de WhatsApp y coordinamos 15 minutos, en persona o por videollamada.
        </p>
      </div>
    </section>
  );
}
