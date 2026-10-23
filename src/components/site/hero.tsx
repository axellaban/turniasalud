import Link from "next/link";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Flecha } from "./iconos";
import { AgenteEnVivo } from "./agente-en-vivo";

// El hero usa cada video solo si el archivo está publicado; si no, el póster (y no hay pedidos 404).
const hay = (archivo: string) => existsSync(join(process.cwd(), "public", "videos", archivo));
const VIDEOS = { movil: hay("hero-mobile.mp4"), webm: hay("hero.webm"), mp4: hay("hero.mp4") };

/**
 * Hero a todo ancho con video de fondo y overlay oscuro a la izquierda, como el de Assort.
 * Sobre el video, el agente «escribe» mensajes sincronizados con cada escena (AgenteEnVivo).
 * Para usar un video, subí `public/videos/hero.mp4` y `hero.webm` (y opcional
 * `hero-mobile.mp4`). Mientras no existan, se ve la foto del póster y los mensajes rotan solos.
 */
export function HeroVideo() {
  return (
    <section className="relative -mt-[76px] min-h-[680px] overflow-hidden bg-brand-950 sm:min-h-[720px]">
      <video
        id="hero-video"
        className="absolute inset-0 h-full w-full object-cover"
        poster="/img/hero.jpg"
        autoPlay
        muted
        loop
        playsInline
        preload="metadata"
        aria-hidden="true"
      >
        {VIDEOS.movil && <source src="/videos/hero-mobile.mp4" type="video/mp4" media="(max-width: 640px)" />}
        {VIDEOS.webm && <source src="/videos/hero.webm" type="video/webm" />}
        {VIDEOS.mp4 && <source src="/videos/hero.mp4" type="video/mp4" />}
      </video>
      <div className="absolute inset-0 bg-[#0b0d1a]/45 sm:bg-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#0b0d1a]/85 via-[#0b0d1a]/45 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-[#0b0d1a]/50 to-transparent" />

      <div className="relative mx-auto flex min-h-[680px] max-w-[1240px] flex-col justify-center gap-10 px-4 pb-12 pt-32 sm:min-h-[720px] sm:px-6 lg:block lg:pb-16 lg:pt-44">
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

        {/* El agente escribiendo, sincronizado con el video (abajo a la derecha en escritorio). */}
        <div className="lg:absolute lg:bottom-14 lg:right-6 lg:w-[480px] xl:right-10">
          <AgenteEnVivo videoId="hero-video" />
        </div>
      </div>
    </section>
  );
}
