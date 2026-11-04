"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { FormularioDemo } from "@/components/site/formulario-demo";
import { cta } from "@/lib/analytics-shared";
import { PLANES, usd, type Plan, type PlanId } from "@/content/precios";

// Lo interactivo de /pricing: mensual o anual, y el plan que eligió (llega al formulario del final).

type Periodo = "mensual" | "anual";
type Estado = { periodo: Periodo; setPeriodo: (p: Periodo) => void; plan: PlanId; setPlan: (p: PlanId) => void };

const Ctx = createContext<Estado | null>(null);
const useEstado = () => {
  const e = useContext(Ctx);
  if (!e) throw new Error("Falta <PreciosProvider>");
  return e;
};

export function PreciosProvider({ children }: { children: ReactNode }) {
  const [periodo, setPeriodo] = useState<Periodo>("mensual");
  const [plan, setPlan] = useState<PlanId>("growth");
  return <Ctx.Provider value={{ periodo, setPeriodo, plan, setPlan }}>{children}</Ctx.Provider>;
}

function Check({ off = false }: { off?: boolean }) {
  return off ? (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-brand-950/25" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M6 10h8" strokeLinecap="round" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-brand-600" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
      <path d="M5 10.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function SelectorPeriodo() {
  const { periodo, setPeriodo } = useEstado();
  const opcion = (p: Periodo, texto: ReactNode) => (
    <button
      type="button"
      role="radio"
      aria-checked={periodo === p}
      onClick={() => setPeriodo(p)}
      className={`relative flex items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600 ${
        periodo === p ? "bg-white text-brand-950 shadow-[0_2px_8px_rgb(8_24_63/0.12)]" : "text-brand-950/60 hover:text-brand-950"
      }`}
    >
      {texto}
    </button>
  );
  return (
    <div role="radiogroup" aria-label="Forma de pago" className="inline-flex rounded-full bg-brand-950/[0.06] p-1">
      {opcion("mensual", "Mensual")}
      {opcion(
        "anual",
        <>
          Anual
          <span className="rounded-full bg-emerald/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">2 meses gratis</span>
        </>,
      )}
    </div>
  );
}

function Tarjeta({ p }: { p: Plan }) {
  const { periodo, setPlan } = useEstado();
  const precio = periodo === "anual" ? p.anual : p.fundador;
  const oscuro = p.destacado;
  const sub = oscuro ? "text-white/65" : "text-tinta";
  const fila = (texto: ReactNode, off = false) => (
    <li className={`flex gap-3 text-sm leading-snug ${off ? (oscuro ? "text-white/40" : "text-brand-950/40") : oscuro ? "text-white/90" : "text-brand-950"}`}>
      {oscuro && !off ? (
        <svg viewBox="0 0 20 20" className="mt-0.5 h-5 w-5 shrink-0 text-aqua" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
          <path d="M5 10.5l3 3 7-7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      ) : (
        <Check off={off} />
      )}
      <span>{texto}</span>
    </li>
  );

  return (
    <article
      aria-labelledby={`plan-${p.id}`}
      className={`relative flex flex-col rounded-3xl p-7 sm:p-8 ${
        oscuro
          ? "bg-navy text-white shadow-[0_30px_70px_rgb(8_24_63/0.35)] ring-1 ring-white/10 lg:-my-4 lg:py-12"
          : "bg-white shadow-[0_8px_30px_rgb(8_24_63/0.06)] ring-1 ring-brand-950/8"
      }`}
    >
      {oscuro && (
        <span className="absolute -top-3.5 left-7 rounded-full bg-gradient-to-r from-aqua to-lila px-3 py-1 text-xs font-semibold text-navy sm:left-8">
          ⭐ Recomendado
        </span>
      )}
      <h3 id={`plan-${p.id}`} className="text-lg font-semibold tracking-tight">
        {p.nombre}
      </h3>
      <p className={`mt-1 text-sm ${sub}`}>{p.escala}</p>

      <div className="mt-6 flex items-end gap-2">
        <span className="text-[52px] font-medium leading-none tracking-tight tabular-nums">{usd(precio)}</span>
        <span className={`pb-1.5 text-sm ${sub}`}>USD/mes</span>
      </div>
      <p className={`mt-2 h-5 text-sm ${sub}`}>
        {periodo === "anual" ? (
          <>
            {usd(p.fundador * 10)} al año · <span className="line-through decoration-1">{usd(p.fundador * 12)}</span>
          </>
        ) : (
          <>
            Precio de lista <span className="line-through decoration-1">{usd(p.lista)}</span>
          </>
        )}
      </p>

      <div className={`mt-5 rounded-xl px-4 py-3 text-sm ${oscuro ? "bg-white/[0.06] ring-1 ring-white/10" : "bg-brand-50/70 ring-1 ring-brand-950/5"}`}>
        <div className="flex items-baseline justify-between gap-3">
          <span className={sub}>Setup único</span>
          <span>
            <span className={`mr-2 line-through decoration-1 ${oscuro ? "text-white/40" : "text-brand-950/40"}`}>{usd(p.setupLista)}</span>
            <span className="font-semibold tabular-nums">{usd(p.setupFundador)} USD</span>
          </span>
        </div>
        <div className="mt-1.5 flex items-baseline justify-between gap-3">
          <span className={sub}>Retorno estimado</span>
          <span className={`font-semibold tabular-nums ${oscuro ? "text-aqua" : "text-emerald-700"}`}>+{usd(p.retorno)} USD/mes</span>
        </div>
      </div>

      <a
        href="#sumate"
        onClick={() => setPlan(p.id)}
        className={`mt-6 rounded-lg px-5 py-3 text-center text-sm font-medium transition focus-visible:outline-2 focus-visible:outline-offset-2 ${
          oscuro ? "bg-white text-navy hover:bg-brand-50 focus-visible:outline-white" : "bg-brand-600 text-white hover:bg-brand-700 focus-visible:outline-brand-600"
        }`}
        {...cta("pricing_plan", "pricing_card", p.id)}
      >
        Quiero {p.nombre}
      </a>

      <ul className={`mt-7 space-y-3 border-t pt-7 ${oscuro ? "border-white/10" : "border-brand-950/8"}`}>
        {fila(<>Atención 24/7: <strong className="font-semibold">{p.atencion}</strong></>)}
        {fila(p.turnos)}
        {fila(p.reactivacion ? <>Reactivación IA: {p.reactivacion}</> : "Reactivación IA no incluida", !p.reactivacion)}
        {fila(<><strong className="font-semibold tabular-nums">{p.conversaciones.toLocaleString("en-US")}</strong> conversaciones de WhatsApp por mes</>)}
        {fila(<><strong className="font-semibold tabular-nums">{p.minutos.toLocaleString("en-US")}</strong> minutos de voz IA por mes</>)}
        {fila(<>Sillón extra: {usd(p.sillonExtra)} USD/mes</>)}
      </ul>
      <p className={`mt-auto pt-6 text-xs leading-relaxed ${oscuro ? "text-white/50" : "text-brand-950/50"}`}>
        Excedentes: ${p.excedente.minuto} USD por minuto y ${p.excedente.conversacion} USD por conversación.
      </p>
    </article>
  );
}

export function TarjetasPlanes() {
  return (
    <div className="grid items-stretch gap-6 lg:grid-cols-3 lg:gap-5">
      {PLANES.map((p) => (
        <Tarjeta key={p.id} p={p} />
      ))}
    </div>
  );
}

export function FormularioFundador() {
  const { periodo, plan, setPlan, setPeriodo } = useEstado();
  const elegido = PLANES.find((p) => p.id === plan)!;
  return (
    <div>
      <fieldset>
        <legend className="text-sm font-medium text-white/70">Plan que te interesa</legend>
        <div className="mt-3 grid gap-2 sm:grid-cols-3">
          {PLANES.map((p) => (
            <label
              key={p.id}
              className={`cursor-pointer rounded-xl px-4 py-3 text-sm ring-1 transition has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-white ${
                plan === p.id ? "bg-white text-navy ring-white" : "text-white ring-white/15 hover:ring-white/40"
              }`}
            >
              <input type="radio" name="plan" value={p.id} checked={plan === p.id} onChange={() => setPlan(p.id)} className="sr-only" />
              <span className="block font-semibold">{p.nombre}</span>
              <span className={`block tabular-nums ${plan === p.id ? "text-navy/60" : "text-white/55"}`}>
                {usd(periodo === "anual" ? p.anual : p.fundador)} USD/mes
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="mt-4 inline-flex cursor-pointer items-center gap-2.5 text-sm text-white/80">
        <input
          type="checkbox"
          checked={periodo === "anual"}
          onChange={(e) => setPeriodo(e.target.checked ? "anual" : "mensual")}
          className="h-4 w-4 rounded accent-aqua"
        />
        Pago anual por adelantado (2 meses gratis)
      </label>
      <div className="mt-6">
        <FormularioDemo
          compacto
          origen={`/pricing · ${elegido.nombre} · ${periodo}`}
          titulo={`Reservá tu lugar en ${elegido.nombre}`}
          boton="Quiero ser clínica fundadora"
          gracias="Te escribimos para coordinar los próximos pasos."
        />
      </div>
    </div>
  );
}
