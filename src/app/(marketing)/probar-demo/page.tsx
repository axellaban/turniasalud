import type { Metadata } from "next";
import Link from "next/link";
import { Icono } from "@/components/site/iconos";
import { demoWhatsappNumber } from "@/lib/demo/config";
import { missingWahaEnv } from "@/lib/env";
import { ProbarDemoForm } from "./probar-demo-form";

export const metadata: Metadata = {
  title: "Probá la demo con tu web",
  description: "Dejá la web de tu consultorio y probá a Turnia por WhatsApp: te atiende como la recepcionista de tu clínica, por llamada, audio o chat.",
};

// Se lee en cada visita: el número sale de DEMO_WHATSAPP_NUMBER o del chip conectado a WAHA.
export const dynamic = "force-dynamic";

const PASOS = [
  { t: "Dejás tu web", d: "Te abrimos WhatsApp con el mensaje listo. Solo tenés que enviarlo.", i: "whatsapp" as const },
  { t: "Turnia lee tu web", d: "Aprende tus profesionales, prestaciones, horarios, coberturas y preguntas frecuentes.", i: "estetoscopio" as const },
  { t: "Elegís cómo probarla", d: "Llamada de voz, audios de WhatsApp o chat. Te atiende como a un paciente que quiere un turno.", i: "grafico" as const },
];

export default async function ProbarDemoPage() {
  // Sin WAHA nadie contestaría el mensaje: el botón se habilita recién con WAHA configurado.
  const whatsapp = missingWahaEnv().length ? "" : ((await demoWhatsappNumber()).number ?? "");
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white">
      <div className="mx-auto max-w-[880px] px-4 pb-24 pt-16 text-center sm:px-6 md:pt-24">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Demo con tu consultorio</p>
        <h1 className="mx-auto mt-4 max-w-[760px] text-[38px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[56px]">
          Probá a Turnia <span className="text-brand-600">con tu propia clínica</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[620px] text-[17px] leading-relaxed text-tinta">
          Pegá la web de tu consultorio. Turnia lee sus secciones principales y te atiende por WhatsApp como si fueras un paciente:
          con tus profesionales, tus prestaciones y tus horarios.
        </p>

        <ProbarDemoForm whatsapp={whatsapp} />

        <ol className="mt-16 grid gap-6 text-left sm:grid-cols-3">
          {PASOS.map((p, i) => (
            <li key={p.t} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-brand-950/5">
              <span className="flex items-center gap-3">
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-600">
                  <Icono nombre={p.i} className="h-5 w-5" />
                </span>
                <span className="text-xs font-semibold uppercase tracking-wider text-brand-600">Paso {i + 1}</span>
              </span>
              <span className="mt-4 block font-semibold text-brand-950">{p.t}</span>
              <span className="mt-1 block text-sm leading-relaxed text-tinta">{p.d}</span>
            </li>
          ))}
        </ol>

        <p className="mx-auto mt-10 max-w-[620px] text-xs leading-relaxed text-tinta/80">
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
