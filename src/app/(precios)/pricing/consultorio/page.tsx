import type { Metadata } from "next";
import { CONSULTORIO, GARANTIAS_CONSULTORIO, LETRA_CHICA_CONSULTORIO } from "@/content/precios";
import { Garantias, LetraChica } from "../bloques";
import { FormularioConsultorio, PreciosProvider, SelectorPeriodo, TarjetaConsultorio } from "../planes";

// Plan Consultorio: un profesional que atiende solo, solo WhatsApp. No está en /pricing ni en ningún menú, y no
// se indexa: el link se manda al cierre de la charla, después de presentar Core Access como referencia.
// Una sola tarjeta, sin los planes de clínica al lado, para no reabrir la decisión.
export const metadata: Metadata = {
  title: "Plan Consultorio · Programa Fundadores",
  description: "Tu WhatsApp atendido las 24 horas mientras vos atendés. Para odontólogos que atienden solos.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

export default function ConsultorioPage() {
  return (
    <PreciosProvider>
      <section className="bg-gradient-to-b from-[#eef2ff] to-white pb-20">
        <div className="mx-auto max-w-[1080px] px-4 pt-14 sm:px-6 sm:pt-20">
          <div className="mx-auto max-w-3xl text-center">
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-950/5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden="true" />
              Programa Fundadores · Plan {CONSULTORIO.nombre}
            </p>
            <h1 className="mt-6 text-[36px] font-medium leading-[1.08] tracking-tight text-brand-950 sm:text-[52px]">
              Tu WhatsApp atendido las 24 horas, <span className="text-brand-600">mientras vos atendés.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-tinta">
              Sofi da, mueve y cancela turnos en tu agenda, le recuerda el turno a cada paciente y, si hay una urgencia que no puede esperar, le pasa tu
              celular. Vos tomás cualquier chat cuando quieras.
            </p>
            <div className="mt-8">
              <SelectorPeriodo />
            </div>
          </div>
          <div className="mt-12">
            <TarjetaConsultorio />
          </div>
        </div>
      </section>

      <Garantias titulo={<>Dos garantías, <span className="text-brand-600">por contrato</span></>} items={GARANTIAS_CONSULTORIO} />

      <section id="sumate" className="scroll-mt-20 bg-navy py-24 text-white">
        <div className="mx-auto grid max-w-[1180px] gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-aqua">Programa Fundadores</p>
            <h2 className="mt-4 text-[34px] font-medium leading-[1.1] tracking-tight sm:text-[46px]">Reservá tu lugar</h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-white/70">
              Precio fundador congelado mientras sigas con nosotros y el setup bonificado. Dejanos tus datos y en 14 días Sofi queda atendiendo tu WhatsApp.
            </p>
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <FormularioConsultorio />
          </div>
          <div>
            <LetraChica items={LETRA_CHICA_CONSULTORIO} />
          </div>
        </div>
      </section>
    </PreciosProvider>
  );
}
