import type { Metadata } from "next";
import { Fragment, type ReactNode } from "react";
import { Icono } from "@/components/site/iconos";
import { cta } from "@/lib/analytics-shared";
import { GARANTIAS, LETRA_CHICA, PLANES, REFERENCIA, usd, type Plan } from "@/content/precios";
import { FormularioFundador, PreciosProvider, SelectorPeriodo, TarjetasPlanes } from "./planes";

// Precios del Programa Fundadores. A propósito no está en el menú, el footer ni el sitemap, y no se
// indexa: solo la ve quien recibe el link.
export const metadata: Metadata = {
  title: "Precios · Programa Fundadores",
  description: "Tu recepción atendiendo por voz y WhatsApp 24/7, por una fracción de un sueldo. Primeras 10 clínicas odontológicas.",
  robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } },
};

const desde = PLANES[0];
const [core, growth] = PLANES;
const excedentes = `Sin descuento fundador: $${core.excedente.minuto} USD/min y $${core.excedente.conversacion} USD/conv en Core Access; $${growth.excedente.minuto} USD/min y $${growth.excedente.conversacion} USD/conv en los planes superiores.`;

/** Recepcionista contra Turnia, en barras a escala: lo que se entiende en 15 segundos. */
function Comparacion() {
  const ancho = (n: number) => `${Math.max(8, Math.round((n / REFERENCIA.recepcionista) * 100))}%`;
  const barra = (titulo: string, detalle: string, monto: number, clase: string, texto: string) => (
    <div>
      <div className="flex items-baseline justify-between gap-4 text-sm">
        <span className="font-medium text-brand-950">{titulo}</span>
        <span className="text-tinta">{detalle}</span>
      </div>
      <div className="mt-2 h-10 rounded-lg bg-brand-950/[0.04]">
        <div className={`flex h-full items-center rounded-lg px-3 text-sm font-semibold tabular-nums ${clase} ${texto}`} style={{ width: ancho(monto) }}>
          {usd(monto)}
        </div>
      </div>
    </div>
  );
  return (
    <div className="rounded-3xl bg-white p-6 text-left shadow-[0_20px_50px_rgb(8_24_63/0.08)] ring-1 ring-brand-950/5 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.14em] text-brand-950/50">Lo que cuesta por mes, en USD</p>
      <div className="mt-5 space-y-5">
        {barra("Recepcionista por convenio", `${REFERENCIA.horasRecepcionista} h por día`, REFERENCIA.recepcionista, "bg-brand-950/15", "text-brand-950")}
        {barra("Turnia, desde", "24 h, 7 días", desde.fundador, "bg-brand-600", "text-white")}
      </div>
      <div className="mt-6 grid grid-cols-2 gap-3 border-t border-brand-950/8 pt-5">
        <p>
          <span className="block text-2xl font-medium tracking-tight text-brand-950 tabular-nums">{Math.round((desde.fundador / REFERENCIA.recepcionista) * 100)}%</span>
          <span className="mt-0.5 block text-sm text-tinta">de un sueldo</span>
        </p>
        <p>
          <span className="block text-2xl font-medium tracking-tight text-brand-950 tabular-nums">{24 / REFERENCIA.horasRecepcionista}×</span>
          <span className="mt-0.5 block text-sm text-tinta">más horas por día</span>
        </p>
      </div>
      <div className="mt-5 flex gap-3 rounded-xl bg-sun-100 px-4 py-3 text-sm text-sun-700">
        <Icono nombre="diente" className="h-5 w-5 shrink-0" />
        <p>
          <strong className="font-semibold">{usd(REFERENCIA.implante)} USD</strong> es lo que perdés con un solo implante que no se agenda porque nadie atendió.
        </p>
      </div>
    </div>
  );
}

type Fila = { label: string; valor: (p: Plan) => ReactNode };
const GRUPOS: Array<{ titulo: string; filas: Fila[] }> = [
  {
    titulo: "Precio",
    filas: [
      { label: "Escala clínica", valor: (p) => p.escala },
      { label: "Precio fundador", valor: (p) => <strong className="font-semibold text-brand-950">{usd(p.fundador)} USD/mes</strong> },
      { label: "Pago anual", valor: (p) => `${usd(p.anual)} USD/mes` },
      { label: "Precio de lista", valor: (p) => <span className="line-through decoration-1">{usd(p.lista)} USD/mes</span> },
      { label: "Setup fundador", valor: (p) => <strong className="font-semibold text-brand-950">{usd(p.setupFundador)} USD</strong> },
      { label: "Setup de lista", valor: (p) => <span className="line-through decoration-1">{usd(p.setupLista)} USD</span> },
    ],
  },
  {
    titulo: "Qué incluye",
    filas: [
      { label: "Atención 24/7", valor: (p) => p.atencion },
      { label: "Gestión de turnos", valor: (p) => p.turnos },
      { label: "Reactivación IA", valor: (p) => p.reactivacion ?? <span className="text-brand-950/40">No incluido</span> },
    ],
  },
  {
    titulo: "Cupos",
    filas: [
      { label: "WhatsApp", valor: (p) => `${p.conversaciones.toLocaleString("en-US")} conv/mes` },
      { label: "Voz IA", valor: (p) => `${p.minutos.toLocaleString("en-US")} min/mes` },
      { label: "Sillón extra", valor: (p) => `${usd(p.sillonExtra)} USD/mes` },
      { label: "Excedentes", valor: (p) => `$${p.excedente.minuto}/min · $${p.excedente.conversacion}/conv` },
    ],
  },
  {
    titulo: "Retorno",
    filas: [{ label: "ROI estimado", valor: (p) => <strong className="font-semibold text-emerald-700">+{usd(p.retorno)} USD/mes</strong> }],
  },
];

function Tabla() {
  const destacado = (p: Plan) => (p.destacado ? "bg-brand-50/70" : "");
  return (
    <div className="overflow-x-auto rounded-3xl bg-white shadow-[0_8px_30px_rgb(8_24_63/0.05)] ring-1 ring-brand-950/8">
      <table className="w-full min-w-[720px] border-collapse text-left text-sm">
        <caption className="sr-only">Comparación de planes del Programa Fundadores</caption>
        <thead>
          <tr>
            <th scope="col" className="w-[26%] px-6 pb-4 pt-6 font-medium text-brand-950/50">
              Característica
            </th>
            {PLANES.map((p) => (
              <th key={p.id} scope="col" className={`px-6 pb-4 pt-6 align-bottom ${destacado(p)} ${p.destacado ? "rounded-t-2xl" : ""}`}>
                {p.destacado && <span className="mb-1.5 block text-xs font-semibold text-brand-600">⭐ Recomendado</span>}
                <span className="block text-base font-semibold text-brand-950">{p.nombre}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {GRUPOS.map((g) => (
            <Fragment key={g.titulo}>
              <tr>
                <th colSpan={1} scope="colgroup" className="px-6 pb-2 pt-7 text-xs font-semibold uppercase tracking-[0.12em] text-brand-600">
                  {g.titulo}
                </th>
                {PLANES.map((p) => (
                  <td key={p.id} className={destacado(p)} />
                ))}
              </tr>
              {g.filas.map((f) => (
                <tr key={f.label} className="border-t border-brand-950/[0.06]">
                  <th scope="row" className="px-6 py-3.5 font-medium text-brand-950">
                    {f.label}
                  </th>
                  {PLANES.map((p) => (
                    <td key={p.id} className={`px-6 py-3.5 text-tinta tabular-nums ${destacado(p)}`}>
                      {f.valor(p)}
                    </td>
                  ))}
                </tr>
              ))}
            </Fragment>
          ))}
          <tr>
            <td className="px-6 pb-6" />
            {PLANES.map((p) => (
              <td key={p.id} className={`px-6 pb-6 pt-2 ${destacado(p)} ${p.destacado ? "rounded-b-2xl" : ""}`} />
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}

export default function PricingPage() {
  return (
    <PreciosProvider>
      {/* Encabezado */}
      <section className="bg-gradient-to-b from-[#eef2ff] to-white">
        <div className="mx-auto grid max-w-[1180px] items-center gap-12 px-4 pb-16 pt-14 sm:px-6 sm:pt-20 lg:grid-cols-[1.1fr_1fr] lg:gap-16">
          <div>
            <p className="inline-flex items-center gap-2 rounded-full bg-white px-3.5 py-1.5 text-xs font-semibold text-brand-700 shadow-sm ring-1 ring-brand-950/5">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald" aria-hidden="true" />
              Programa Fundadores · Primeras 10 clínicas odontológicas
            </p>
            <h1 className="mt-6 text-[38px] font-medium leading-[1.06] tracking-tight text-brand-950 sm:text-[56px]">
              Tu recepción atendiendo por voz y WhatsApp 24/7, <span className="text-brand-600">por una fracción de un sueldo.</span>
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-relaxed text-tinta">
              Una recepcionista por convenio cuesta {usd(REFERENCIA.recepcionista)} USD/mes y trabaja {REFERENCIA.horasRecepcionista} horas; un solo implante perdido por no
              atender el teléfono te cuesta {usd(REFERENCIA.implante)} USD.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <a href="#planes" className="rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white shadow-sm hover:bg-brand-700" {...cta("pricing_see_plans", "pricing_hero", "planes", "navigation")}>
                Ver los planes
              </a>
              <a href="#sumate" className="rounded-lg bg-white px-5 py-3 text-sm font-medium text-brand-950 ring-1 ring-brand-950/10 hover:ring-brand-950/25" {...cta("pricing_join", "pricing_hero", "sumate")}>
                Reservar mi lugar
              </a>
            </div>
          </div>
          <Comparacion />
        </div>
      </section>

      {/* Planes */}
      <section id="planes" className="scroll-mt-24 pb-20">
        <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <h2 className="text-[32px] font-medium leading-[1.12] tracking-tight text-brand-950 sm:text-[44px]">Elegí según tus sillones</h2>
            <p className="mx-auto mt-4 text-[17px] leading-relaxed text-tinta">
              <strong className="font-semibold text-brand-950">Tarifa congelada para siempre</strong> mientras mantengas tu suscripción activa. Pagando el año por adelantado, 2 meses son gratis.
            </p>
            <div className="mt-8">
              <SelectorPeriodo />
            </div>
          </div>
          <div className="mt-14">
            <TarjetasPlanes />
          </div>
        </div>
      </section>

      {/* Comparación completa */}
      <section className="mx-auto max-w-[1180px] px-4 pb-24 max-md:hidden sm:px-6">
        <h2 className="text-center text-2xl font-medium tracking-tight text-brand-950 sm:text-[32px]">Todo, lado a lado</h2>
        <div className="mt-10">
          <Tabla />
        </div>
      </section>

      {/* Garantías */}
      <section className="bg-[#f5f7fd] py-24">
        <div className="mx-auto max-w-[1180px] px-4 sm:px-6">
          <div className="mx-auto max-w-2xl text-center">
            <span className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-white text-brand-600 shadow-sm ring-1 ring-brand-950/5">
              <Icono nombre="escudo" className="h-6 w-6" />
            </span>
            <h2 className="mt-5 text-[32px] font-medium leading-[1.12] tracking-tight text-brand-950 sm:text-[44px]">
              Triple garantía, <span className="text-brand-600">por contrato</span>
            </h2>
            <p className="mt-4 text-[17px] leading-relaxed text-tinta">Si no cumplimos, lo pagamos nosotros.</p>
          </div>
          <ol className="mt-14 grid gap-5 md:grid-cols-3">
            {GARANTIAS.map((g, i) => (
              <li key={g.titulo} className="rounded-3xl bg-white p-7 shadow-[0_6px_24px_rgb(8_24_63/0.05)] ring-1 ring-brand-950/8 sm:p-8">
                <span className="text-xs font-semibold uppercase tracking-[0.12em] text-brand-950/40">Garantía {i + 1}</span>
                <p className="mt-3 text-[34px] font-medium leading-none tracking-tight text-brand-600 tabular-nums">{g.plazo}</p>
                <h3 className="mt-5 font-semibold text-brand-950">{g.titulo}</h3>
                <p className="mt-2 text-sm leading-relaxed text-tinta">{g.texto}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Cierre: sumarse */}
      <section id="sumate" className="scroll-mt-20 bg-navy py-24 text-white">
        <div className="mx-auto grid max-w-[1180px] gap-14 px-4 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:grid-rows-[auto_1fr] lg:gap-x-16 lg:gap-y-0">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.14em] text-aqua">Programa Fundadores</p>
            <h2 className="mt-4 text-[34px] font-medium leading-[1.1] tracking-tight sm:text-[46px]">Solo para las primeras 10 clínicas odontológicas</h2>
            <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-white/70">
              Precio fundador congelado mientras sigas con nosotros, setup con descuento y la triple garantía. Dejanos tus datos y armamos juntos la puesta en marcha.
            </p>
          </div>
          <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <FormularioFundador />
          </div>
          <div>
            <dl className="space-y-6 border-t border-white/10 pt-8 lg:mt-10">
              {LETRA_CHICA.map((l) => (
                <div key={l.titulo} className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-6">
                  <dt className="text-sm font-semibold text-white">{l.titulo}</dt>
                  <dd className="text-sm leading-relaxed text-white/60">{l.texto}</dd>
                </div>
              ))}
              <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-6">
                <dt className="text-sm font-semibold text-white">Excedentes</dt>
                <dd className="text-sm leading-relaxed text-white/60">
                  {excedentes}
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </section>
    </PreciosProvider>
  );
}
