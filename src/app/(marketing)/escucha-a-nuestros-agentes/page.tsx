import type { Metadata } from "next";
import { ReproductorDemo } from "@/components/site/reproductor-demo";
import { CONVERSACIONES } from "@/content/conversaciones";

export const metadata: Metadata = {
  title: "Escuchá a nuestros agentes",
  description: "Conversaciones completas de Turnia atendiendo pacientes en pediatría, clínica médica, ginecología, dermatología, gastroenterología y cardiología.",
};

// Como /listen-to-our-voice-agents-in-action de Assort: una tarjeta por especialidad
// con "Escuchar demo" y duración. La conversación de la home va primero.
export default function EscuchaPage() {
  return (
    <section className="bg-[#eaf0ff] pb-24 pt-16 sm:pt-24">
      <div className="mx-auto max-w-[860px] px-4 sm:px-6">
        <h1 className="text-center text-[44px] font-medium leading-[1.05] tracking-tight text-brand-800 sm:text-[64px]">Escuchá a nuestros agentes</h1>
        <p className="mx-auto mt-4 max-w-xl text-center text-[17px] text-tinta">
          Así atiende Turnia ejemplos simulados de conversaciones con pacientes en distintas especialidades.
        </p>
        <ul className="mt-14 space-y-5">
          {CONVERSACIONES.map((c) => (
            <li key={c.slug} id={c.slug} className="scroll-mt-28">
              <ReproductorDemo conversacion={c} variante="tarjeta" />
            </li>
          ))}
        </ul>
        <p className="mt-10 flex items-center justify-center gap-2 text-tinta">
          <svg viewBox="0 0 24 24" className="h-6 w-6 text-brand-800" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden="true">
            <path d="M6 3v18M12 3v18M18 3v18" />
            <path d="M4 15h4M10 8h4M16 13h4" />
          </svg>
          Conversaciones reales. Impacto real.
        </p>
      </div>
    </section>
  );
}
