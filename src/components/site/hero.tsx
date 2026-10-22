import Link from "next/link";
import { Flecha, Icono } from "./iconos";

/**
 * Hero a todo ancho con video de fondo y overlay oscuro a la izquierda, como el de Assort.
 * Para usar un video propio, subí `public/videos/hero.mp4` (y opcional `hero.webm`,
 * `hero-mobile.mp4`). Mientras no exista, se ve la foto del póster.
 */
export function HeroVideo() {
  return (
    <section className="relative -mt-[76px] min-h-[640px] overflow-hidden bg-brand-950 sm:min-h-[720px]">
      <video
        className="absolute inset-0 h-full w-full object-cover"
        poster="/img/hero.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
      >
        <source src="/videos/hero-mobile.mp4" type="video/mp4" media="(max-width: 640px)" />
        <source src="/videos/hero.webm" type="video/webm" />
        <source src="/videos/hero.mp4" type="video/mp4" />
      </video>
      <div className="absolute inset-0 bg-[#0b0d1a]/45 sm:bg-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b0d1a]/85 via-[#0b0d1a]/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0b0d1a]/50 to-transparent" />

      <div className="relative mx-auto flex min-h-[640px] max-w-[1240px] items-center px-4 pb-16 pt-32 sm:min-h-[720px] sm:px-6">
        <div className="max-w-xl text-white">
          <p className="inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-xs font-medium backdrop-blur">
            <span className="flex text-sun-300" aria-hidden="true">
              ★★★★★
            </span>
            Atención 24/7 · WhatsApp, audios y llamadas
          </p>
          <h1 className="mt-5 text-5xl font-medium leading-[1.04] tracking-tight sm:text-[64px]">
            Cada paciente,
            <br />
            bien atendido.
          </h1>
          <p className="mt-6 max-w-md text-[17px] leading-relaxed text-white/85">
            El agente de IA de Turnia atiende el WhatsApp y el teléfono de tu clínica: da turnos sobre tu agenda real, toma la
            admisión, deriva lo urgente y le escribe a tus pacientes para que vuelvan.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <Link href="/probar-demo" className="inline-flex items-center gap-2 rounded-lg bg-white px-5 py-3 text-sm font-medium text-brand-950 hover:bg-brand-50">
              Probalo con tu web <Flecha />
            </Link>
            <Link href="#en-accion" className="inline-flex items-center gap-2 rounded-lg px-5 py-3 text-sm font-medium text-white ring-1 ring-white/40 hover:bg-white/10">
              Miralo en acción
            </Link>
          </div>
        </div>

        {/* Burbujas flotantes de WhatsApp (solo escritorio). */}
        <div className="pointer-events-none absolute bottom-24 right-6 hidden w-[330px] space-y-3 xl:block" aria-hidden="true">
          <Burbuja quien="paciente" texto="Hola! Necesito turno con dermato, tengo OSDE 310" delay="0s" />
          <Burbuja quien="agente" texto="¡Hola Laura! Con la Dra. Ruiz tengo el jueves 13 a las 9:40 o el viernes 14 a las 11:20. ¿Cuál preferís?" delay="0.8s" />
          <Burbuja quien="paciente" audio delay="1.6s" />
          <Burbuja quien="agente" texto="Listo, te reservé el viernes 14 a las 11:20. Te mando la ubicación y te recuerdo el día anterior ✅" delay="2.4s" />
        </div>
      </div>
    </section>
  );
}

function Burbuja({ quien, texto, audio, delay }: { quien: "agente" | "paciente"; texto?: string; audio?: boolean; delay: string }) {
  const agente = quien === "agente";
  return (
    <div className={`animar-aparecer flex ${agente ? "justify-start" : "justify-end"}`} style={{ animationDelay: delay }}>
      <div
        className={`max-w-[88%] rounded-2xl px-4 py-2.5 text-[13px] leading-snug shadow-lg ${
          agente ? "rounded-tl-sm bg-white text-brand-950" : "rounded-tr-sm bg-[#dcf8c6] text-brand-950"
        }`}
      >
        {agente && (
          <span className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold text-brand-600">
            <Icono nombre="whatsapp" className="h-3.5 w-3.5" /> Sofi · Turnia
          </span>
        )}
        {audio ? (
          <span className="flex w-44 items-center gap-2">
            <span className="grid h-6 w-6 place-items-center rounded-full bg-emerald text-[10px] text-white">▶</span>
            <span className="flex h-4 flex-1 items-end gap-[2px]">
              {[5, 9, 4, 12, 7, 14, 6, 10, 4, 8, 12, 5, 9, 3].map((h, i) => (
                <span key={i} className="w-[3px] rounded-full bg-brand-950/40" style={{ height: `${h}px` }} />
              ))}
            </span>
            <span className="text-[11px] text-brand-950/60">0:03</span>
          </span>
        ) : (
          texto
        )}
      </div>
    </div>
  );
}
