import type { Metadata } from "next";
import Link from "next/link";
import { FormularioDemo } from "@/components/site/formulario-demo";
import { Icono } from "@/components/site/iconos";

export const metadata: Metadata = {
  title: "Pedí una demo",
  description: "Mirá cómo Turnia atiende el WhatsApp y el teléfono de tu clínica, con tu agenda y tu especialidad.",
};

const PUNTOS = [
  { t: "Con tu especialidad", d: "Configuramos la demo con tipos de turno, coberturas y protocolos parecidos a los tuyos.", i: "estetoscopio" as const },
  { t: "WhatsApp y voz", d: "Escuchás y probás al agente en los canales que usan tus pacientes.", i: "whatsapp" as const },
  { t: "Panel y campañas", d: "Recorremos la agenda, la bandeja de tareas, las métricas y las campañas.", i: "grafico" as const },
];

export default function PediUnaDemoPage() {
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white">
      <div className="mx-auto grid max-w-[1100px] gap-12 px-4 pb-24 pt-16 sm:px-6 md:grid-cols-[1fr_1.1fr] md:pt-20">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Pedí una demo</p>
          <h1 className="mt-4 text-[40px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[52px]">
            Mirá a Turnia <span className="text-brand-600">atendiendo tu clínica</span>
          </h1>
          <p className="mt-5 text-[17px] leading-relaxed text-tinta">
            En 30 minutos te mostramos cómo el agente da turnos, hace la admisión, deriva urgencias y recupera pacientes, con
            ejemplos de tu especialidad.
          </p>
          <ul className="mt-10 space-y-6">
            {PUNTOS.map((p) => (
              <li key={p.t} className="flex gap-4">
                <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-950/5">
                  <Icono nombre={p.i} className="h-5 w-5" />
                </span>
                <span>
                  <span className="block font-semibold text-brand-950">{p.t}</span>
                  <span className="mt-1 block text-sm leading-relaxed text-tinta">{p.d}</span>
                </span>
              </li>
            ))}
          </ul>
          <div id="contacto" className="mt-10 scroll-mt-28 rounded-2xl bg-white p-5 text-sm ring-1 ring-brand-950/5">
            <p className="font-semibold text-brand-950">¿Querés probarlo ya?</p>
            <p className="mt-1 text-tinta">
              <Link href="/escucha-a-nuestros-agentes" className="font-medium text-brand-600 hover:underline">
                Escuchá conversaciones de ejemplo
              </Link>{" "}
              o, si ya tenés acceso,{" "}
              <Link href="/demo" className="font-medium text-brand-600 hover:underline">
                hablá con el agente
              </Link>
              .
            </p>
          </div>
        </div>
        <FormularioDemo origen="/pedi-una-demo" />
      </div>
    </section>
  );
}
