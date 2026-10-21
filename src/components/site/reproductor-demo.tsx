"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatearTiempo, type Conversacion } from "@/content/conversaciones";
import { inicioDeLinea, leerSincronizacion, lineaActiva, type Sincronizacion } from "./reproductor-sync";

// Reproductor de las demos de audio. Lee /audios/<slug>.mp3 y /audios/<slug>.json
// (los genera scripts/generar-audios.mjs). Si todavía no existen, muestra el guion
// con "Audio próximamente".

type Estado = "cargando" | "listo" | "sin-audio";

const EVENTO_PLAY = "turnia:demo-play";

const CSS = `
@keyframes turnia-barra { from { transform: scaleY(.3) } to { transform: scaleY(1) } }
@keyframes turnia-anillo { from { transform: scale(1); opacity: .55 } to { transform: scale(1.75); opacity: 0 } }
.turnia-barra { transform: scaleY(.55); transform-origin: center; transition: transform .4s ease }
.turnia-sonando .turnia-barra { animation: turnia-barra .85s ease-in-out infinite alternate }
.turnia-anillo { animation: turnia-anillo 2.8s ease-out infinite }
@media (prefers-reduced-motion: reduce) {
  .turnia-sonando .turnia-barra, .turnia-anillo { animation: none }
}
`;

const COLORES: Record<Conversacion["color"], { cuadro: string; boton: string; acento: string }> = {
  brand: { cuadro: "bg-[#4eb49e]", boton: "border-[#4eb49e] text-[#3f9c88]", acento: "accent-[#3f9c88]" },
  lila: { cuadro: "bg-[#b3b1ff]", boton: "border-[#b3b1ff] text-[#8b88f2]", acento: "accent-[#8b88f2]" },
  cielo: { cuadro: "bg-[#4a86f0]", boton: "border-[#4a86f0] text-[#3a72dc]", acento: "accent-[#3a72dc]" },
  sun: { cuadro: "bg-sun-500", boton: "border-sun-500 text-sun-600", acento: "accent-sun-600" },
};

// Alturas relativas de las barras del ecualizador (como el orbe de la home de Assort).
const BARRAS = [0.32, 0.5, 0.78, 0.46, 0.92, 0.66, 1, 0.58, 0.84, 0.44, 0.3];

function useReproductor(conversacion: Conversacion) {
  const id = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [estado, setEstado] = useState<Estado>("cargando");
  const [sync, setSync] = useState<Sincronizacion | null>(null);
  const [sonando, setSonando] = useState(false);
  const [tiempo, setTiempo] = useState(0);
  const [duracionAudio, setDuracionAudio] = useState<number | null>(null);
  const totalLineas = conversacion.lineas.length;

  useEffect(() => {
    const control = new AbortController();
    fetch(`/audios/${conversacion.slug}.json`, { signal: control.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((datos) => {
        const leido = leerSincronizacion(datos, totalLineas);
        setSync(leido);
        setEstado(leido ? "listo" : "sin-audio");
      })
      .catch(() => {
        if (!control.signal.aborted) setEstado("sin-audio");
      });
    return () => control.abort();
  }, [conversacion.slug, totalLineas]);

  // Un solo reproductor sonando por página.
  useEffect(() => {
    function otroEmpezo(e: Event) {
      if ((e as CustomEvent<string>).detail !== id) audioRef.current?.pause();
    }
    window.addEventListener(EVENTO_PLAY, otroEmpezo);
    return () => window.removeEventListener(EVENTO_PLAY, otroEmpezo);
  }, [id]);

  // timeupdate llega ~4 veces por segundo; con requestAnimationFrame la barra y el
  // resaltado avanzan suaves.
  useEffect(() => {
    if (!sonando) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setTiempo(audioRef.current.currentTime);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sonando]);

  const alternar = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || estado !== "listo") return;
    if (audio.paused) {
      window.dispatchEvent(new CustomEvent(EVENTO_PLAY, { detail: id }));
      audio.play().catch(() => setSonando(false));
    } else {
      audio.pause();
    }
  }, [estado, id]);

  const buscar = useCallback((segundo: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = segundo;
    setTiempo(segundo);
  }, []);

  const saltarALinea = useCallback(
    (linea: number) => {
      const inicio = sync ? inicioDeLinea(sync.segmentos, linea) : null;
      if (inicio === null) return;
      buscar(inicio);
      if (audioRef.current?.paused) alternar();
    },
    [sync, buscar, alternar],
  );

  const duracion = duracionAudio ?? sync?.duracion ?? 0;
  const activa = sync && (sonando || tiempo > 0) ? lineaActiva(sync.segmentos, tiempo) : -1;

  const audio =
    estado === "listo" ? (
      <audio
        ref={audioRef}
        src={`/audios/${conversacion.slug}.mp3`}
        preload="metadata"
        onPlay={() => setSonando(true)}
        onPause={() => setSonando(false)}
        onEnded={() => {
          setSonando(false);
          setTiempo(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuracionAudio(d);
        }}
        onError={() => {
          setSonando(false);
          setEstado("sin-audio");
        }}
      />
    ) : null;

  return { estado, sonando, tiempo, duracion, activa, alternar, buscar, saltarALinea, audio };
}

export function ReproductorDemo({ conversacion, variante = "tarjeta" }: { conversacion: Conversacion; variante?: "orbe" | "tarjeta" }) {
  const r = useReproductor(conversacion);
  return (
    <>
      <style href="turnia-reproductor" precedence="medium">
        {CSS}
      </style>
      {r.audio}
      {variante === "orbe" ? <VarianteOrbe conversacion={conversacion} r={r} /> : <VarianteTarjeta conversacion={conversacion} r={r} />}
    </>
  );
}

type Reproductor = ReturnType<typeof useReproductor>;

function VarianteOrbe({ conversacion, r }: { conversacion: Conversacion; r: Reproductor }) {
  const disponible = r.estado === "listo";
  const hablaPaciente = r.activa >= 0 && conversacion.lineas[r.activa]?.quien === "paciente";
  const etiqueta = r.sonando ? "Pausar la conversación" : `Escuchar la conversación: ${conversacion.titulo}`;

  return (
    <div
      className="relative overflow-hidden rounded-[28px] px-4 pb-8 pt-10 sm:px-10 sm:pb-12 sm:pt-12"
      style={{ background: "radial-gradient(130% 95% at 50% 32%, #f6f7ff 0%, #e4e8fd 30%, #b9c6f5 68%, #8fa6ee 100%)" }}
    >
      <p className="text-center text-lg font-medium tracking-tight text-brand-950 sm:text-xl">Escuchá a Sofi en acción</p>
      <p className="mx-auto mt-1 max-w-md text-center text-sm text-brand-950/60">{conversacion.descripcion}</p>

      <div className="mt-10 flex flex-col items-center sm:mt-12">
        <button
          type="button"
          onClick={r.alternar}
          disabled={!disponible}
          aria-label={etiqueta}
          aria-pressed={r.sonando}
          className={`group relative grid h-44 w-44 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-white/90 disabled:cursor-default sm:h-52 sm:w-52 ${
            r.sonando ? "turnia-sonando" : ""
          }`}
        >
          <span aria-hidden="true" className="absolute -inset-12 rounded-full bg-white/55 blur-3xl" />
          {r.sonando && (
            <>
              <span aria-hidden="true" className="turnia-anillo absolute inset-0 rounded-full border-2 border-white/70" />
              <span aria-hidden="true" className="turnia-anillo absolute inset-0 rounded-full border-2 border-white/60 [animation-delay:1.4s]" />
            </>
          )}
          <span
            aria-hidden="true"
            className="absolute inset-0 rounded-full transition-[filter,transform] duration-700 group-enabled:group-hover:scale-[1.03]"
            style={{
              background: "radial-gradient(circle at 34% 28%, #a9bcff 0%, #6f8ff0 20%, #2157e1 58%, #0e3ca7 100%)",
              boxShadow:
                "inset 0 -14px 34px rgba(6, 22, 90, .45), inset 0 12px 26px rgba(255, 255, 255, .32), 0 24px 60px rgba(33, 87, 225, .35)",
              filter: hablaPaciente ? "hue-rotate(28deg) saturate(.9)" : "none",
            }}
          />
          <span
            aria-hidden="true"
            className="absolute left-[16%] top-[5%] h-[42%] w-[68%] rounded-full"
            style={{ background: "radial-gradient(ellipse at 50% 28%, rgba(255,255,255,.5) 0%, rgba(255,255,255,.12) 45%, rgba(255,255,255,0) 72%)" }}
          />
          <span aria-hidden="true" className="relative flex h-14 items-center gap-[5px]">
            {BARRAS.map((alto, i) => (
              <span
                key={i}
                className="turnia-barra w-[3px] rounded-full bg-white/95"
                style={{ height: `${Math.round(alto * 52)}px`, animationDelay: `${(i * -0.17).toFixed(2)}s` }}
              />
            ))}
          </span>
        </button>

        <div className="mt-8 flex min-h-9 items-center justify-center">
          {r.estado === "sin-audio" ? (
            <ProximamenteBadge />
          ) : (
            <button
              type="button"
              onClick={r.alternar}
              disabled={!disponible}
              className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-brand-950 shadow-sm ring-1 ring-white transition hover:bg-white disabled:opacity-60"
            >
              <IconoPlay sonando={r.sonando} className="h-3.5 w-3.5" />
              {r.sonando ? "Pausar" : r.tiempo > 0 ? "Seguir escuchando" : "Escuchar la llamada"}
              <span className="tabular-nums text-brand-950/55">· {disponible ? formatearTiempo(r.duracion) : "…"}</span>
            </button>
          )}
        </div>

        {disponible && (
          <BarraProgreso r={r} className="mt-5 w-full max-w-md" acento="accent-brand-600" claro />
        )}
      </div>

      <Transcripcion
        conversacion={conversacion}
        r={r}
        className="mx-auto mt-8 max-h-72 max-w-2xl rounded-2xl bg-white/55 p-3 ring-1 ring-white/80 backdrop-blur sm:p-4"
      />
    </div>
  );
}

function VarianteTarjeta({ conversacion, r }: { conversacion: Conversacion; r: Reproductor }) {
  const [abierta, setAbierta] = useState(false);
  const colores = COLORES[conversacion.color];
  const disponible = r.estado === "listo";
  const mostrar = abierta || r.sonando;
  const panelId = useId();

  return (
    <article className="rounded-2xl border border-brand-900/10 bg-white p-5 shadow-[0_1px_2px_rgba(16,24,40,.04)] sm:p-7">
      <div className="flex flex-col gap-5 sm:flex-row sm:items-center">
        <div className="grid min-w-0 flex-1 grid-cols-[auto_1fr] items-center gap-x-4 gap-y-3 sm:gap-x-6 sm:gap-y-1">
          <span
            className={`grid h-14 w-14 shrink-0 place-items-center rounded-xl text-white sm:row-span-2 sm:h-[88px] sm:w-[88px] ${colores.cuadro}`}
          >
            <Icono nombre={conversacion.icono} className="h-7 w-7 sm:h-11 sm:w-11" />
          </span>
          <h3 className="min-w-0 self-center text-xl font-semibold tracking-tight text-brand-900 sm:self-end sm:text-[28px] sm:leading-tight">
            {conversacion.titulo}
          </h3>
          <p className="col-span-2 text-[15px] leading-relaxed text-brand-900/70 sm:col-span-1 sm:col-start-2 sm:self-start">
            {conversacion.descripcion}
          </p>
        </div>

        <div className="flex items-center gap-4 sm:w-48 sm:shrink-0 sm:justify-end">
          <button
            type="button"
            onClick={() => {
              setAbierta(true);
              r.alternar();
            }}
            disabled={!disponible}
            aria-label={r.sonando ? `Pausar la demo de ${conversacion.titulo}` : `Escuchar la demo de ${conversacion.titulo}`}
            aria-pressed={r.sonando}
            className={`grid h-14 w-14 shrink-0 place-items-center rounded-full border-2 bg-white transition hover:scale-105 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-brand-200 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:scale-100 ${colores.boton}`}
          >
            <IconoPlay sonando={r.sonando} className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <p className="font-semibold text-brand-900">{r.sonando ? "Pausar" : "Escuchar demo"}</p>
            <p className="text-sm tabular-nums text-brand-900/60">
              {disponible
                ? r.sonando || r.tiempo > 0
                  ? `${formatearTiempo(r.tiempo)} / ${formatearTiempo(r.duracion)}`
                  : formatearTiempo(r.duracion)
                : r.estado === "sin-audio"
                  ? `≈ ${conversacion.duracionEstimada}`
                  : "…"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 sm:pl-[112px]">
        {r.estado === "sin-audio" && <ProximamenteBadge />}
        <button
          type="button"
          onClick={() => setAbierta((v) => !v)}
          aria-expanded={mostrar}
          aria-controls={panelId}
          className="text-sm font-medium text-brand-600 underline-offset-4 hover:underline"
        >
          {mostrar ? "Ocultar la conversación" : "Leer la conversación"}
        </button>
      </div>

      {mostrar && (
        <div id={panelId} className="mt-5 border-t border-brand-900/10 pt-5">
          {disponible && <BarraProgreso r={r} className="mb-4" acento={colores.acento} />}
          <Transcripcion conversacion={conversacion} r={r} className="max-h-80 rounded-xl bg-brand-50/60 p-3 sm:p-4" />
        </div>
      )}
    </article>
  );
}

function BarraProgreso({ r, className = "", acento, claro = false }: { r: Reproductor; className?: string; acento: string; claro?: boolean }) {
  return (
    <div className={`flex items-center gap-3 text-xs tabular-nums ${claro ? "text-brand-950/70" : "text-brand-900/60"} ${className}`}>
      <span className="w-10 text-right">{formatearTiempo(r.tiempo)}</span>
      <input
        type="range"
        min={0}
        max={Math.max(r.duracion, 0.1)}
        step={0.1}
        value={Math.min(r.tiempo, r.duracion)}
        onChange={(e) => r.buscar(Number(e.target.value))}
        aria-label="Posición del audio"
        aria-valuetext={`${formatearTiempo(r.tiempo)} de ${formatearTiempo(r.duracion)}`}
        className={`h-1.5 flex-1 cursor-pointer ${acento}`}
      />
      <span className="w-10">{formatearTiempo(r.duracion)}</span>
    </div>
  );
}

function Transcripcion({ conversacion, r, className = "" }: { conversacion: Conversacion; r: Reproductor; className?: string }) {
  const contenedor = useRef<HTMLOListElement>(null);
  const puedeSaltar = r.estado === "listo";

  // Desplaza solo el contenedor de la transcripción, nunca la página.
  useEffect(() => {
    const caja = contenedor.current;
    if (!caja || r.activa < 0) return;
    const fila = caja.querySelector<HTMLElement>(`[data-linea="${r.activa}"]`);
    if (!fila) return;
    const reducir = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    caja.scrollTo({ top: Math.max(0, fila.offsetTop - caja.clientHeight / 3), behavior: reducir ? "auto" : "smooth" });
  }, [r.activa]);

  return (
    <ol ref={contenedor} aria-live="off" aria-label={`Transcripción: ${conversacion.titulo}`} className={`relative space-y-2.5 overflow-y-auto ${className}`}>
      {conversacion.lineas.map((linea, i) => {
        const esAgente = linea.quien === "agente";
        const actual = i === r.activa;
        const atenuada = r.activa >= 0 && !actual;
        const burbuja = `max-w-[88%] rounded-2xl px-3.5 py-2.5 text-left text-[14px] leading-relaxed transition duration-300 sm:max-w-[80%] ${
          esAgente ? "rounded-tl-md bg-white text-brand-950" : "rounded-tr-md bg-brand-600 text-white"
        } ${actual ? "shadow-md ring-2 ring-brand-400/50" : "shadow-sm"} ${atenuada ? "opacity-55" : ""}`;
        const contenido = (
          <>
            <span className={`mb-0.5 block text-[11px] font-semibold uppercase tracking-wide ${esAgente ? "text-brand-600" : "text-white/75"}`}>
              {esAgente ? "Sofi · Turnia" : "Paciente"}
            </span>
            {linea.texto}
          </>
        );
        return (
          <li key={i} data-linea={i} aria-current={actual ? "true" : undefined} className={`flex ${esAgente ? "justify-start" : "justify-end"}`}>
            {puedeSaltar ? (
              <button type="button" onClick={() => r.saltarALinea(i)} className={`${burbuja} cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-500`}>
                {contenido}
              </button>
            ) : (
              <p className={burbuja}>{contenido}</p>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function ProximamenteBadge() {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sun-100 px-3 py-1 text-xs font-semibold text-sun-600 ring-1 ring-sun-300/60">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-sun-500" />
      Audio próximamente
    </span>
  );
}

function IconoPlay({ sonando, className }: { sonando: boolean; className?: string }) {
  return sonando ? (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <rect x="6" y="5" width="4" height="14" rx="1.2" />
      <rect x="14" y="5" width="4" height="14" rx="1.2" />
    </svg>
  ) : (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" fill="currentColor">
      <path d="M8 5.6v12.8c0 .8.9 1.3 1.6.9l10-6.4c.6-.4.6-1.3 0-1.7l-10-6.4C8.9 4.3 8 4.8 8 5.6z" />
    </svg>
  );
}

const ICONOS: Record<string, ReactNode> = {
  telefono: (
    <path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z" />
  ),
  bebe: (
    <>
      <path d="M9 12h.01M15 12h.01" />
      <path d="M10 16c.5.3 1.2.5 2 .5s1.5-.2 2-.5" />
      <path d="M19 6.3a9 9 0 0 1 1.8 3.9 2 2 0 0 1 0 3.6 9 9 0 0 1-17.6 0 2 2 0 0 1 0-3.6A9 9 0 0 1 12 3c2 0 3.5 1.1 3.5 2.5S14.6 8 13.5 8c-.8 0-1.5-.4-1.5-1" />
    </>
  ),
  estetoscopio: (
    <>
      <path d="M5 2H4a2 2 0 0 0-2 2v5a6 6 0 0 0 12 0V4a2 2 0 0 0-2-2h-1" />
      <path d="M8 15v1a6 6 0 0 0 12 0v-4" />
      <circle cx="20" cy="10" r="2" />
    </>
  ),
  embarazo: (
    <>
      <circle cx="11.5" cy="4" r="2" />
      <path d="M10.5 7.5C9.3 8.3 8.5 9.8 8.5 11.5v3l1.5 1V22" />
      <path d="M12.5 7.5c1.6.4 2.6 1.8 2.6 3.3 1.7.6 2.9 2.1 2.9 3.8 0 1.9-1.5 3.1-3.4 3.1h-1.1V22" />
      <path d="M8.5 11.5h3.5" />
    </>
  ),
  piel: (
    <>
      <circle cx="10.5" cy="10.5" r="6.5" />
      <path d="m21 21-5.6-5.6" />
      <circle cx="9" cy="9.5" r="1.4" fill="currentColor" stroke="none" />
      <circle cx="12.5" cy="12" r=".9" fill="currentColor" stroke="none" />
    </>
  ),
  estomago: (
    <path d="M9 2.5v3.2c0 1.6-1 2.7-2.6 3.4C4.6 9.9 3.5 11.6 3.5 14a7.5 7.5 0 0 0 7.5 7.5h1.5A8 8 0 0 0 20.5 13c0-2.6-1.6-4.5-3.8-4.5-1.9 0-3.1 1.3-3.9 2.9-.6 1.2-2.2 1.3-2.8.1" />
  ),
  corazon: (
    <>
      <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21.2l7.8-7.8 1-1a5.5 5.5 0 0 0 0-7.8z" />
      <path d="M3.5 12h4l1.5-2.5 3 5 1.5-2.5h7" />
    </>
  ),
};

function Icono({ nombre, className }: { nombre: string; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {ICONOS[nombre] ?? ICONOS.telefono}
    </svg>
  );
}
