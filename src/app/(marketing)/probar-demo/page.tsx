import type { Metadata } from "next";
import Link from "next/link";
import { demoStatus } from "@/lib/demo/config";
import { ProbarDemoForm } from "./probar-demo-form";

export const metadata: Metadata = {
  title: "Probá la demo con tu web",
  description: "Dejá la web de tu consultorio y probá a Turnia por chat, audio o llamada: te atiende como la recepcionista de tu clínica, por llamada, audio o chat.",
};

// Se lee en cada visita: el número sale de DEMO_WHATSAPP_NUMBER o del chip conectado a WAHA.
export const dynamic = "force-dynamic";

export default async function ProbarDemoPage() {
  // Sin WAHA nadie contestaría el mensaje: el botón se habilita recién con WAHA configurado.
  const status = await demoStatus();
  const channel = status.canal;
  const ready = status.base && (channel === "telegram" ? status.telegram : channel === "whatsapp" && status.whatsapp);
  const channelName = channel === "telegram" ? "Telegram" : "WhatsApp";
  return (
    <section className="bg-gradient-to-b from-[#eef2ff] to-white">
      <div className="mx-auto max-w-[880px] px-4 pb-24 pt-16 text-center sm:px-6 md:pt-24">
        <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-600">Demo con tu consultorio</p>
        <h1 className="mx-auto mt-4 max-w-[760px] text-[38px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[56px]">
          Probá a Turnia <span className="text-brand-600">con tu propia clínica</span>
        </h1>
        <p className="mx-auto mt-5 max-w-[620px] text-[17px] leading-relaxed text-tinta">
          Pegá la web de tu consultorio. Turnia lee sus secciones principales y te atiende por {channelName} como si fueras un paciente:
          con tus profesionales, tus prestaciones y tus horarios.
        </p>

        <ProbarDemoForm channel={channel} ready={ready} />

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
