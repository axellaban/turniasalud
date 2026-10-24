import Link from "next/link";
import { LogoMark } from "@/components/logo";
import { ESPECIALIDADES } from "@/content/especialidades";
import { INTEGRACIONES } from "@/content/site";
import type { Beneficio, Faq, IconoClave } from "@/content/tipos";
import { Flecha, Icono } from "./iconos";

// Secciones estáticas de la web pública, en el orden y con el diseño de assorthealth.com.

export function Titulo({ linea1, linea2, bajada, className = "" }: { linea1: string; linea2?: string; bajada?: string; className?: string }) {
  return (
    <div className={`mx-auto max-w-3xl text-center ${className}`}>
      <h2 className="text-[32px] font-medium leading-[1.12] tracking-tight text-brand-950 sm:text-[44px]">
        {linea1}
        {linea2 && (
          <>
            <br />
            <span className="text-brand-600">{linea2}</span>
          </>
        )}
      </h2>
      {bajada && <p className="mx-auto mt-4 max-w-2xl text-[17px] leading-relaxed text-tinta">{bajada}</p>}
    </div>
  );
}

export function Eyebrow({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <p className={`text-xs font-semibold uppercase tracking-[0.14em] text-brand-600 ${className}`}>{children}</p>;
}

/** Reemplaza la grilla de logos de clientes: especialidades en gris, igual de sobria. */
export function GrillaEspecialidades() {
  return (
    <section className="mx-auto max-w-[1100px] px-4 py-20 sm:px-6">
      <ul className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-6">
        {ESPECIALIDADES.map((e) => (
          <li key={e.slug}>
            <Link href={`/especialidades/${e.slug}`} className="group flex items-center justify-center gap-2 text-brand-950/65 transition hover:text-brand-600">
              <Icono nombre={e.icono} className="h-6 w-6 shrink-0" />
              <span className="text-[15px] font-semibold tracking-tight">{e.nombre}</span>
            </Link>
          </li>
        ))}
      </ul>
      <h2 className="mx-auto mt-16 max-w-2xl text-center text-[28px] font-medium leading-tight tracking-tight text-brand-950 sm:text-[34px]">
        Pensado para clínicas y consultorios de <span className="text-brand-600">más de 18 especialidades y todo tipo de centros de salud</span>
      </h2>
      <div className="mt-8 text-center">
        <Link href="/especialidades" className="inline-flex items-center gap-2 rounded-lg bg-brand-50 px-5 py-3 text-sm font-medium text-brand-700 hover:bg-brand-100">
          Ver todas las especialidades <Flecha />
        </Link>
      </div>
    </section>
  );
}

/** Banda "Get a Demo with Our Voice AI". */
export function BandaProbalo() {
  return (
    <section className="mx-auto max-w-[1100px] px-4 sm:px-6">
      <div className="rounded-3xl bg-gradient-to-b from-[#bfeee5] via-[#e3f7f3] to-white px-6 py-14 text-center">
        <div className="mx-auto flex h-8 items-end justify-center gap-[3px]" aria-hidden="true">
          {[8, 14, 20, 12, 24, 16, 28, 18, 22, 10, 16, 8].map((h, i) => (
            <span key={i} className="w-[3px] rounded-full bg-brand-950/25" style={{ height: `${h}px` }} />
          ))}
        </div>
        <h2 className="mt-4 text-2xl font-medium tracking-tight text-brand-950 sm:text-[28px]">Probá a Sofi con tu consultorio, por chat o por voz</h2>
        <Link href="/probar-demo" className="mt-6 inline-flex items-center gap-2 rounded-lg bg-brand-600 px-5 py-3 text-sm font-medium text-white hover:bg-brand-700">
          Probalo con tu web <Flecha />
        </Link>
        <p className="mt-4 text-sm font-medium text-brand-950">
          O <Link href="/escucha-a-nuestros-agentes" className="underline underline-offset-4 hover:text-brand-600">escuchá conversaciones de ejemplo</Link>
        </p>
      </div>
    </section>
  );
}

/** Diagrama del motor (equivalente al "Synapse AI Engine" de Assort), con datos reales del producto. */
export function MotorProtocolos() {
  const entradas = ["Agendas, horarios y tipos de turno", "Protocolos de urgencia y preguntas frecuentes", "Coberturas y reglas por profesional"];
  const salidas = [
    { t: "Flujos por clínica y especialidad", d: "Cada centro configura sus reglas, indicaciones previas y derivaciones." },
    { t: "Mejora continua", d: "Cada conversación se evalúa (pedido resuelto, seguridad clínica) y alimenta los ajustes." },
  ];
  // Lo que el agente recuerda de cada paciente (en lugar de repetir la grilla de especialidades de arriba).
  const memoria: { n: string; i: IconoClave }[] = [
    { n: "Su cobertura", i: "admision" },
    { n: "Su profesional", i: "estetoscopio" },
    { n: "Sus turnos", i: "calendario" },
    { n: "Sus pedidos", i: "tareas" },
    { n: "Sus horarios preferidos", i: "reloj" },
    { n: "Sus conversaciones", i: "chat" },
  ];
  return (
    <section className="mx-auto max-w-[1180px] px-4 py-24 sm:px-6">
      <Titulo
        linea1="Resolvé los circuitos de atención más complejos del mundo real"
        bajada="Un motor que combina tu agenda, tus reglas y la memoria de cada paciente para guiarlo en cada paso, incluso en los casos más finos."
      />
      <div className="mt-14 grid items-center gap-6 lg:grid-cols-[220px_1fr_220px]">
        <ul className="relative space-y-4 lg:pr-4">
          {entradas.map((e) => (
            <li key={e} className="relative rounded-xl bg-gradient-to-b from-white to-[#e7f6f1] px-4 py-3 text-center text-sm font-semibold leading-snug text-brand-950 shadow-[0_6px_20px_rgb(78_180_158/0.18)] ring-1 ring-emerald/30">
              {e}
              <span className="absolute -right-5 top-1/2 hidden h-px w-5 bg-emerald/60 lg:block" aria-hidden="true" />
            </li>
          ))}
        </ul>

        <div className="rounded-2xl bg-[#1c1c2d] p-5 text-white shadow-2xl sm:p-6">
          <div className="flex items-center gap-3">
            <LogoMark className="h-10 w-10" />
            <div>
              <p className="font-semibold">Turnia Salud</p>
              <p className="text-xs text-white/60">Motor de agenda y memoria</p>
            </div>
          </div>
          <dl className="mt-6 grid grid-cols-3 gap-3">
            {[
              ["24/7", "Atención continua"],
              ["3", "Canales: WhatsApp, teléfono y web"],
              ["18", "Especialidades"],
            ].map(([v, l]) => (
              <div key={l}>
                <dt className="text-2xl font-medium tracking-tight sm:text-3xl">{v}</dt>
                <dd className="mt-1 text-[11px] text-white/60">{l}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-6 rounded-lg bg-aqua py-2.5 text-center text-sm font-semibold text-navy">Memoria del paciente e inteligencia</p>
          <p className="mt-5 text-center text-sm font-medium text-white/90">Lo que recuerda de cada paciente</p>
          <ul className="mt-3 grid grid-cols-3 gap-1.5">
            {memoria.map((b) => (
              <li key={b.n} className="flex flex-col items-center gap-1 rounded-md bg-white/5 px-1 py-2.5 text-center">
                <Icono nombre={b.i} className="h-4 w-4 text-white/80" />
                <span className="text-[10px] leading-tight text-white/70">{b.n}</span>
              </li>
            ))}
          </ul>
        </div>

        <ul className="space-y-6 lg:pl-4">
          {salidas.map((s) => (
            <li key={s.t} className="relative rounded-xl bg-gradient-to-b from-white to-sun-100 px-4 py-3 text-center shadow-[0_6px_20px_rgb(255_154_31/0.18)] ring-1 ring-sun-300">
              <span className="absolute -left-5 top-1/2 hidden h-px w-5 bg-sun-500/70 lg:block" aria-hidden="true" />
              <p className="text-sm font-semibold text-brand-950">{s.t}</p>
              <p className="mt-1 text-xs leading-snug text-tinta">{s.d}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** Las tres tarjetas con gradiente (verde, lila, naranja). */
export function TarjetasGradiente() {
  const tarjetas: { t: string; d: string; i: IconoClave; c: string }[] = [
    {
      t: "Precisión por especialidad",
      d: "Cada especialidad trae sus tipos de turno, duraciones, indicaciones previas y coberturas por profesional, listos desde el primer día.",
      i: "estetoscopio",
      c: "from-[#e4f7f1] to-[#a9dccd]",
    },
    {
      t: "Cada conversación, personalizada",
      d: "Cada conversación parte de la anterior: cobertura, preferencias de horario, turnos y pedidos pendientes. El paciente se siente reconocido.",
      i: "memoria",
      c: "from-[#ecebff] to-[#bdb8f0]",
    },
    {
      t: "Todo el recorrido del paciente",
      d: "De la admisión y el turno al recordatorio, la receta y la encuesta: Turnia acompaña cada paso, las 24 horas.",
      i: "red",
      c: "from-[#fff3e2] to-[#ffc98a]",
    },
  ];
  return (
    <div className="grid gap-4 md:grid-cols-3">
      {tarjetas.map((x) => (
        <article key={x.t} className={`flex flex-col items-center rounded-2xl bg-gradient-to-b ${x.c} px-6 py-8 text-center`}>
          <h3 className="max-w-[14rem] text-xl font-medium leading-snug tracking-tight text-brand-950">{x.t}</h3>
          <span
            className="my-8 grid h-24 w-24 place-items-center rounded-full bg-white/60 text-brand-950/70 shadow-[inset_0_-8px_20px_rgb(0_0_0/0.06),0_12px_30px_rgb(0_0_0/0.08)]"
            style={{ animation: "turnia-flotar 5s ease-in-out infinite" }}
            aria-hidden="true"
          >
            <Icono nombre={x.i} className="h-11 w-11" />
          </span>
          <p className="text-sm leading-relaxed text-brand-950/70">{x.d}</p>
        </article>
      ))}
    </div>
  );
}

/** Integraciones alrededor de un círculo central (la "órbita" de EHR/PMS de Assort). */
export function OrbitaIntegraciones() {
  // Posiciones en % alrededor del centro (escritorio).
  const pos = [
    [8, 12],
    [26, 28],
    [32, 58],
    [22, 84],
    [50, 92],
    [74, 82],
    [70, 48],
    [90, 16],
  ];
  return (
    <section className="mx-auto max-w-[1180px] px-4 py-16 sm:px-6">
      <div className="rounded-3xl bg-gradient-to-b from-[#f2f5ff] to-white px-4 pb-10 pt-16 sm:px-10">
        <Titulo
          linea1="Conectado a los canales"
          linea2="que ya usan tus pacientes"
          bajada="WhatsApp, teléfono y web con el mismo agente, conectado a las herramientas de tu equipo sin programar."
        />
        <div className="relative mx-auto mt-10 hidden h-[420px] max-w-[980px] md:block">
          <div className="absolute left-1/2 top-1/2 grid h-40 w-40 -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-white shadow-[0_20px_60px_rgb(8_24_63/0.12)]">
            <div className="grid h-28 w-28 place-items-center rounded-full bg-white shadow-[inset_0_0_0_1px_rgb(8_24_63/0.06),0_8px_24px_rgb(8_24_63/0.08)]">
              <LogoMark className="h-12 w-12" />
            </div>
          </div>
          {INTEGRACIONES.map((x, i) => (
            <div
              key={x.nombre}
              className="absolute flex -translate-x-1/2 -translate-y-1/2 items-center gap-2 rounded-lg bg-white px-3 py-2.5 shadow-[0_6px_20px_rgb(8_24_63/0.08)] ring-1 ring-brand-950/5"
              style={{ left: `${pos[i][0]}%`, top: `${pos[i][1]}%`, animation: `turnia-flotar ${5 + (i % 3)}s ease-in-out ${i * 0.3}s infinite` }}
            >
              <span className="grid h-8 w-8 place-items-center rounded-md bg-brand-50 text-brand-600">
                <Icono nombre={x.icono} className="h-4 w-4" />
              </span>
              <span>
                <span className="block text-sm font-semibold text-brand-950">{x.nombre}</span>
                <span className="block text-[11px] text-tinta">{x.detalle}</span>
              </span>
            </div>
          ))}
        </div>
        <ul className="mt-10 grid grid-cols-2 gap-3 md:hidden">
          {INTEGRACIONES.map((x) => (
            <li key={x.nombre} className="flex items-center gap-2 rounded-lg bg-white p-3 shadow-sm ring-1 ring-brand-950/5">
              <Icono nombre={x.icono} className="h-4 w-4 shrink-0 text-brand-600" />
              <span className="text-sm font-medium text-brand-950">{x.nombre}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * "Real Results Across Real Practices", con números de estudios publicados (no de
 * clientes de Turnia) más uno propio del producto. Cada número cita su fuente.
 */
export function TarjetasResultados() {
  const items: { v: string; d: string; fuente: string; href?: string; c: string; nota: string }[] = [
    {
      v: "24/7",
      d: "Turnia responde turnos y consultas a cualquier hora, también los fines de semana y feriados",
      fuente: "Turnia",
      c: "bg-emerald text-brand-950",
      nota: "text-brand-950/80",
    },
    {
      v: "23%",
      d: "De los turnos se pierden en promedio porque el paciente no se presenta",
      fuente: "Dantas y otros, Health Policy, 2018",
      href: "https://pubmed.ncbi.nlm.nih.gov/29482948/",
      c: "bg-[#5048c4] text-white",
      nota: "text-white/85",
    },
    {
      v: "29,5%",
      d: "De los turnos que los pacientes sacan solos se piden con el consultorio cerrado",
      fuente: "North y otros, JMIR Medical Informatics, 2021",
      href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC8077742/",
      c: "bg-cielo text-brand-950",
      nota: "text-brand-950/75",
    },
    {
      v: "−29%",
      d: "Menos ausencias cuando el paciente recibe recordatorios automáticos",
      fuente: "Hasvold y Wootton, J Telemed Telecare, 2011",
      href: "https://pmc.ncbi.nlm.nih.gov/articles/PMC3188816/",
      c: "bg-sun-500 text-brand-950",
      nota: "text-brand-950/80",
    },
  ];
  return (
    <section className="mx-auto max-w-[1100px] px-4 py-24 sm:px-6">
      <Titulo
        linea1="Lo que dicen los números"
        bajada="Turnos que se pierden, pacientes que piden fuera de horario y recordatorios que funcionan: datos de estudios publicados."
      />
      <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((x) => (
          <div key={x.v} className={`flex flex-col rounded-2xl p-6 ${x.c}`}>
            <p className="text-[40px] font-medium leading-none tracking-tight tabular-nums">{x.v}</p>
            <p className="mt-6 flex-1 text-[15px] leading-snug">{x.d}</p>
            <p className={`mt-5 text-xs ${x.nota}`}>
              {x.href ? (
                <a href={x.href} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2 hover:no-underline">
                  {x.fuente}
                </a>
              ) : (
                x.fuente
              )}
            </p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-center text-xs text-tinta">Los tres estudios son de la industria de la salud: no son resultados de clientes de Turnia.</p>
    </section>
  );
}

// ── Bloques reutilizados por las páginas internas ──────────────────────────────────────

export function GrillaBeneficios({ titulo, items }: { titulo: string; items: Beneficio[] }) {
  return (
    <div>
      <h2 className="text-center text-[28px] font-medium tracking-tight text-brand-950 sm:text-[34px]">{titulo}</h2>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {items.map((b) => (
          <div key={b.titulo} className="rounded-2xl bg-white p-6 ring-1 ring-brand-950/8 shadow-[0_6px_24px_rgb(8_24_63/0.05)]">
            <h3 className="font-semibold text-brand-950">{b.titulo}</h3>
            <p className="mt-2 text-sm leading-relaxed text-tinta">{b.texto}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

export function PreguntasFrecuentes({ faqs }: { faqs: Faq[] }) {
  return (
    <section className="mx-auto max-w-3xl px-4 py-20 sm:px-6">
      <h2 className="text-center text-[32px] font-medium tracking-tight text-brand-950 sm:text-[40px]">Preguntas frecuentes</h2>
      <div className="mt-10 divide-y divide-brand-950/10 border-y border-brand-950/10">
        {faqs.map((f) => (
          <details key={f.pregunta} className="group py-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-left font-medium text-brand-950 [&::-webkit-details-marker]:hidden">
              {f.pregunta}
              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-brand-50 text-brand-600 transition group-open:rotate-45" aria-hidden="true">
                +
              </span>
            </summary>
            <p className="mt-3 pr-10 leading-relaxed text-tinta">{f.respuesta}</p>
          </details>
        ))}
      </div>
    </section>
  );
}
