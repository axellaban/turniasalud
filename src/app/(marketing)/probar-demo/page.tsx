import type { Metadata } from "next";
import Link from "next/link";
import { demoStatus } from "@/lib/demo/config";
import { isConfigured } from "@/lib/env";
import { ProbarDemoForm } from "./probar-demo-form";

export const metadata: Metadata = {
  title: "Probá la demo con tu web",
  description: "Dejá la web de tu consultorio y probá a Turnia en el navegador: te atiende como la recepcionista de tu clínica, por chat o por voz.",
};

// Se lee en cada visita: el canal de chat activo se elige en el panel.
export const dynamic = "force-dynamic";

const PASOS = [
  { n: "1", t: "Dejás tu web y tu email", d: "La de tu consultorio, tal como la ven tus pacientes." },
  { n: "2", t: "Leemos tu web", d: "Profesionales, prestaciones, dirección y horarios. Tarda alrededor de un minuto." },
  { n: "3", t: "Sofi te atiende", d: "Como si fueras un paciente: pedile un turno por chat o hablale por voz." },
];

export default async function ProbarDemoPage() {
  const status = await demoStatus();
  const channel = status.canal;
  const chatReady = status.base && (channel === "telegram" ? status.telegram : channel === "whatsapp" && status.whatsapp);
  const webReady = status.base && isConfigured().elevenlabs;
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white">
      <div className="mx-auto max-w-[880px] px-4 pb-24 pt-16 text-center sm:px-6 md:pt-24">
        <h1 className="mx-auto max-w-[760px] text-[38px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[56px]">
          Probá a Turnia <span className="text-brand-600">con tu propio consultorio</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[620px] text-[17px] leading-relaxed text-tinta">
          Turnia lee tu web y en un minuto tenés a Sofi atendiendo como la recepción de tu consultorio: con tus profesionales, tus
          prestaciones y tus horarios.
        </p>

        <ProbarDemoForm channel={channel} webReady={webReady} chatReady={chatReady} />

        <ol className="mx-auto mt-14 grid max-w-[820px] gap-4 text-left sm:grid-cols-3">
          {PASOS.map((p) => (
            <li key={p.n} className="rounded-2xl bg-white p-5 ring-1 ring-brand-950/5">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-brand-600 text-sm font-semibold text-white">{p.n}</span>
              <p className="mt-3 font-semibold text-brand-950">{p.t}</p>
              <p className="mt-1 text-sm leading-relaxed text-tinta">{p.d}</p>
            </li>
          ))}
        </ol>

        {/* Ejemplo ilustrativo de cómo responde, para que se sepa qué esperar antes de dejar los datos. */}
        <figure className="mx-auto mt-10 max-w-[460px] rounded-2xl bg-[#f5f7fc] p-4 text-left ring-1 ring-brand-950/5">
          <figcaption className="mb-3 text-xs font-medium text-tinta">Ejemplo de una conversación</figcaption>
          <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-md bg-brand-600 px-3.5 py-2 text-[15px] text-white">
            Hola, quiero un turno para una limpieza.
          </p>
          <p className="mt-2 w-fit max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3.5 py-2 text-[15px] text-brand-950 ring-1 ring-brand-950/5">
            ¡Hola! Soy Sofi, de tu consultorio. Tengo el martes a las 10:30 o el jueves a las 16. ¿Cuál te queda mejor?
          </p>
        </figure>

        <p className="mx-auto mt-10 max-w-[620px] text-sm leading-relaxed text-tinta">
          La demo usa solo la información pública de tu web. Los turnos que reserves son de prueba y no llegan a tu agenda real.
          ¿Preferís que te la mostremos nosotros?{" "}
          <Link href="/pedi-una-demo" className="font-medium text-brand-600 hover:underline">
            Pedí una demo guiada
          </Link>
          .
        </p>
      </div>
    </section>
  );
}
