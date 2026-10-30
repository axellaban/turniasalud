"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { formatearTiempo, type Conversacion } from "@/content/conversaciones";
import { inicioDeLinea, leerSincronizacion, lineaActiva, type Sincronizacion } from "./reproductor-sync";
import type { PasoEscena } from "@/content/escena-home";
import { ListenTracker } from "@/lib/interaction-tracking";

// Reproductor de las demos de audio. Lee /audios/<slug>.mp3 + .json (scripts/generar-audios.mjs)
// o /api/audios/<slug>.mp3 + .json (generados desde Panel → Configuración). Si todavía no
// hay audio, el play reproduce la conversación como lectura animada.

// "listo": hay audio. "texto": todavía no se generó el audio y la conversación se
// reproduce como lectura animada, con tiempos estimados por cantidad de palabras.
type Estado = "cargando" | "listo" | "texto";

const EVENTO_PLAY = "turnia:demo-play";

const CSS = `
@keyframes turnia-barra { from { transform: scaleY(.3) } to { transform: scaleY(1) } }
@keyframes turnia-anillo { from { transform: scale(1); opacity: .55 } to { transform: scale(1.75); opacity: 0 } }
.turnia-barra { transform: scaleY(.55); transform-origin: center; transition: transform .4s ease }
.turnia-sonando .turnia-barra { animation: turnia-barra .85s ease-in-out infinite alternate }
.turnia-anillo { animation: turnia-anillo 2.8s ease-out infinite }
@keyframes turnia-entra { from { opacity: 0; transform: translateY(10px) scale(.98) } to { opacity: 1; transform: none } }
.turnia-entra { animation: turnia-entra .55s cubic-bezier(.2,.7,.2,1) both }
@media (prefers-reduced-motion: reduce) {
  .turnia-sonando .turnia-barra, .turnia-anillo, .turnia-entra { animation: none }
}
`;

const COLORES: Record<Conversacion["color"], { cuadro: string; boton: string; acento: string }> = {
  brand: { cuadro: "bg-[#4eb49e]", boton: "border-[#4eb49e] text-emerald-700", acento: "accent-[#3f9c88]" },
  lila: { cuadro: "bg-[#b3b1ff]", boton: "border-[#b3b1ff] text-[#8b88f2]", acento: "accent-[#8b88f2]" },
  cielo: { cuadro: "bg-[#4a86f0]", boton: "border-[#4a86f0] text-[#3a72dc]", acento: "accent-[#3a72dc]" },
  sun: { cuadro: "bg-sun-500", boton: "border-sun-500 text-sun-700", acento: "accent-sun-600" },
};

// Alturas relativas de las barras del ecualizador (como el orbe de la home de Assort).
const BARRAS = [0.32, 0.5, 0.78, 0.46, 0.92, 0.66, 1, 0.58, 0.84, 0.44, 0.3];

/** Tiempos estimados por línea para la lectura animada (sin audio). */
function sincronizacionEstimada(conversacion: Conversacion): Sincronizacion {
  let t = 0.6;
  const segmentos = conversacion.lineas.map((l, linea) => {
    const palabras = l.texto.split(/\s+/).filter(Boolean).length;
    const dura = Math.max(1.6, palabras / 3.2); // ~190 palabras por minuto de lectura
    const s = { linea, inicio: t, fin: t + dura };
    t += dura + 0.5;
    return s;
  });
  return { duracion: t, segmentos };
}

/** Slugs con audio en public/audios, anotados al compilar (next.config.ts). */
const AUDIOS_REPO = new Set((process.env.TURNIA_AUDIOS_REPO ?? "").split(",").filter(Boolean));

async function buscarSincronizacion(slug: string, totalLineas: number, signal: AbortSignal) {
  // Los archivos del repo (public/audios) tienen prioridad; si no hay, los generados desde el panel.
  const base = AUDIOS_REPO.has(slug) ? "/audios" : "/api/audios";
  const res = await fetch(`${base}/${slug}.json`, { signal }).catch(() => null);
  if (!res?.ok) return null;
  const sync = leerSincronizacion(await res.json().catch(() => null), totalLineas);
  return sync ? { sync, src: `${base}/${slug}.mp3` } : null;
}

function useReproductor(conversacion: Conversacion) {
  const id = useId();
  const audioRef = useRef<HTMLAudioElement>(null);
  const [estado, setEstado] = useState<Estado>("cargando");
  const [sync, setSync] = useState<Sincronizacion | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [sonando, setSonando] = useState(false);
  const [tiempo, setTiempo] = useState(0);
  const [duracionAudio, setDuracionAudio] = useState<number | null>(null);
  // Reloj de la lectura animada: segundo de partida y momento en que arrancó.
  const reloj = useRef({ base: 0, desde: 0 });
  const totalLineas = conversacion.lineas.length;

  const usarTexto = useCallback(() => {
    setSync(sincronizacionEstimada(conversacion));
    setEstado("texto");
  }, [conversacion]);

  useEffect(() => {
    const control = new AbortController();
    buscarSincronizacion(conversacion.slug, totalLineas, control.signal)
      .then((encontrado) => {
        if (control.signal.aborted) return;
        if (encontrado) {
          setSync(encontrado.sync);
          setSrc(encontrado.src);
          setEstado("listo");
        } else usarTexto();
      })
      .catch(() => {
        if (!control.signal.aborted) usarTexto();
      });
    return () => control.abort();
  }, [conversacion.slug, totalLineas, usarTexto]);

  const pausar = useCallback(() => {
    if (audioRef.current) audioRef.current.pause();
    else setSonando(false);
  }, []);

  // Un solo reproductor sonando por página.
  useEffect(() => {
    function otroEmpezo(e: Event) {
      if ((e as CustomEvent<string>).detail !== id) pausar();
    }
    window.addEventListener(EVENTO_PLAY, otroEmpezo);
    return () => window.removeEventListener(EVENTO_PLAY, otroEmpezo);
  }, [id, pausar]);

  const duracion = duracionAudio ?? sync?.duracion ?? 0;

  // PostHog: cuánto se escucha de cada muestra (un evento por tramo, nunca por segundo).
  const escucha = useRef<ListenTracker | null>(null);
  const conAudio = estado === "listo";
  useEffect(() => {
    const t = new ListenTracker({ audio_id: conversacion.slug, with_audio: conAudio });
    escucha.current = t;
    return () => {
      t.dispose();
      escucha.current = null;
    };
  }, [conversacion.slug, conAudio]);
  useEffect(() => {
    if (sonando) escucha.current?.play();
    else escucha.current?.stop("pause");
  }, [sonando]);
  useEffect(() => escucha.current?.progress(tiempo, duracion), [tiempo, duracion]);

  // timeupdate llega ~4 veces por segundo; con requestAnimationFrame la barra y el
  // resaltado avanzan suaves. En modo texto, el reloj es propio.
  useEffect(() => {
    if (!sonando) return;
    let frame = 0;
    const tick = () => {
      if (audioRef.current) setTiempo(audioRef.current.currentTime);
      else {
        const t = reloj.current.base + (performance.now() - reloj.current.desde) / 1000;
        if (t >= duracion) {
          escucha.current?.stop("ended");
          setSonando(false);
          setTiempo(0);
          return;
        }
        setTiempo(t);
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [sonando, duracion]);

  const alternar = useCallback(() => {
    if (estado === "cargando") return;
    const audio = audioRef.current;
    if (estado === "listo" && audio) {
      if (audio.paused) {
        window.dispatchEvent(new CustomEvent(EVENTO_PLAY, { detail: id }));
        audio.play().catch(() => setSonando(false));
      } else audio.pause();
      return;
    }
    if (sonando) {
      setSonando(false);
    } else {
      window.dispatchEvent(new CustomEvent(EVENTO_PLAY, { detail: id }));
      reloj.current = { base: tiempo, desde: performance.now() };
      setSonando(true);
    }
  }, [estado, id, sonando, tiempo]);

  const buscar = useCallback((segundo: number) => {
    const audio = audioRef.current;
    if (audio) audio.currentTime = segundo;
    reloj.current = { base: segundo, desde: performance.now() };
    setTiempo(segundo);
  }, []);

  const saltarALinea = useCallback(
    (linea: number) => {
      const inicio = sync ? inicioDeLinea(sync.segmentos, linea) : null;
      if (inicio === null) return;
      buscar(inicio);
      if (!sonando) alternar();
    },
    [sync, buscar, alternar, sonando],
  );

  const activa = sync && (sonando || tiempo > 0) ? lineaActiva(sync.segmentos, tiempo) : -1;

  const audio =
    estado === "listo" && src ? (
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setSonando(true)}
        onPause={() => setSonando(false)}
        onEnded={() => {
          escucha.current?.stop("ended");
          setSonando(false);
          setTiempo(0);
        }}
        onLoadedMetadata={(e) => {
          const d = e.currentTarget.duration;
          if (Number.isFinite(d) && d > 0) setDuracionAudio(d);
        }}
        onError={() => {
          setSonando(false);
          setSrc(null);
          usarTexto();
        }}
      />
    ) : null;

  return { estado, sonando, tiempo, duracion, activa, segmentos: sync?.segmentos ?? [], alternar, buscar, saltarALinea, audio };
}

export function ReproductorDemo({ conversacion, variante = "tarjeta", pasos }: { conversacion: Conversacion; variante?: "orbe" | "tarjeta" | "escena"; pasos?: Record<number, PasoEscena> }) {
  const r = useReproductor(conversacion);
  return (
    <>
      <style href="turnia-reproductor" precedence="medium">
        {CSS}
      </style>
      {r.audio}
      {variante === "escena" ? <VarianteEscena conversacion={conversacion} r={r} pasos={pasos ?? {}} />
        : variante === "orbe" ? <VarianteOrbe conversacion={conversacion} r={r} /> : <VarianteTarjeta conversacion={conversacion} r={r} />}
    </>
  );
}

type Reproductor = ReturnType<typeof useReproductor>;

function VarianteOrbe({ conversacion, r }: { conversacion: Conversacion; r: Reproductor }) {
  const disponible = r.estado !== "cargando";
  const conAudio = r.estado === "listo";
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
          <button
            type="button"
            onClick={r.alternar}
            disabled={!disponible}
            className="inline-flex items-center gap-2 rounded-full bg-white/80 px-4 py-2 text-sm font-medium text-brand-950 shadow-sm ring-1 ring-white transition hover:bg-white disabled:opacity-60"
          >
            <IconoPlay sonando={r.sonando} className="h-3.5 w-3.5" />
            {r.sonando ? "Pausar" : r.tiempo > 0 ? "Seguir" : conAudio ? "Escuchar la llamada" : "Ver la conversación"}
            <span className="tabular-nums text-brand-950/65">· {disponible ? formatearTiempo(r.duracion) : "…"}</span>
          </button>
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

/**
 * Como la sección «Watch Assort in action»: entra en una pantalla. Al centro el orbe
 * con play; a la izquierda Sofi (su objetivo y lo que dice, escrito al ritmo de su voz)
 * y a la derecha el paciente (lo que dice y los datos que el agente va detectando).
 */
function VarianteEscena({ conversacion, r, pasos }: { conversacion: Conversacion; r: Reproductor; pasos: Record<number, PasoEscena> }) {
  const [verTodo, setVerTodo] = useState(false);
  const disponible = r.estado !== "cargando";
  const conAudio = r.estado === "listo";
  const lineas = conversacion.lineas;
  const activa = r.activa;
  const empezo = activa >= 0;
  const hablaPaciente = empezo && lineas[activa]?.quien === "paciente";

  const progreso = (linea: number, desde = 0, dura?: number) => {
    const s = r.segmentos.find((x) => x.linea === linea);
    if (!s) return 1;
    const total = dura ?? Math.max(0.3, s.fin - s.inicio);
    return Math.min(1, Math.max(0, (r.tiempo - s.inicio - desde) / total));
  };
  const escrito = (linea: number) => {
    const texto = lineas[linea]?.texto ?? "";
    return linea === activa ? texto.slice(0, Math.ceil(texto.length * progreso(linea))) : texto;
  };
  const ultima = (quien: "agente" | "paciente") => {
    for (let i = activa; i >= 0; i--) if (lineas[i]?.quien === quien) return i;
    return -1;
  };
  const ultimoPaso = <K extends keyof PasoEscena>(clave: K) => {
    for (let i = Math.max(activa, 0); i >= 0; i--) if (pasos[i]?.[clave]) return { linea: i, valor: pasos[i][clave]! };
    return null;
  };
  const iAgente = ultima("agente");
  const iPaciente = ultima("paciente");
  const objetivo = ultimoPaso("objetivo");
  const dato = empezo ? ultimoPaso("dato") : null;
  const datoEscrito = dato ? dato.valor.valor.slice(0, Math.ceil(dato.valor.valor.length * (dato.linea === activa ? progreso(dato.linea, 0.2, 1.2) : 1))) : "";
  const etiqueta = r.sonando ? "Pausar la conversación" : `Escuchar la conversación: ${conversacion.titulo}`;

  const tarjeta = "rounded-2xl bg-white/75 p-4 text-left shadow-[0_12px_40px_rgba(33,87,225,.14)] ring-1 ring-white backdrop-blur-md";
  const cursor = <span aria-hidden="true" className="ml-0.5 inline-block h-[1em] w-[2px] translate-y-[2px] animate-pulse bg-brand-600/70" />;

  return (
    <div
      className="relative overflow-hidden rounded-[28px] px-4 pb-5 pt-7 sm:px-8 lg:flex lg:h-[min(600px,calc(100svh-120px))] lg:min-h-[460px] lg:flex-col lg:px-10 lg:pb-5 lg:pt-7"
      style={{ background: "radial-gradient(130% 95% at 50% 32%, #f6f7ff 0%, #e4e8fd 30%, #b9c6f5 68%, #8fa6ee 100%)" }}
    >
      <p className="text-center text-lg font-medium tracking-tight text-brand-950 sm:text-xl">Escuchá a Sofi en acción</p>
      <p className="mx-auto mt-1 hidden max-w-lg text-center text-sm text-brand-950/60 sm:block">{conversacion.descripcion}</p>

      <div className="mt-5 grid flex-1 items-center gap-4 lg:mt-4 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-8">
        {/* Sofi: objetivo y lo que dice. */}
        <div className={`order-2 space-y-3 transition-opacity duration-500 lg:order-1 ${hablaPaciente ? "lg:opacity-60" : ""}`}>
          {objetivo && (
            <div key={`o${objetivo.linea}`} className={`turnia-entra inline-block ${tarjeta} px-4 py-2.5`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-950">Objetivo</p>
              <p className="text-sm text-brand-950/70">{objetivo.valor}</p>
            </div>
          )}
          <div className={`${tarjeta} ${empezo && !hablaPaciente ? "ring-2 ring-brand-400/50" : ""}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-600">Sofi · recepcionista</p>
            <p className="mt-1.5 flex h-[4.6rem] flex-col justify-end overflow-hidden text-[14px] leading-relaxed text-brand-950 sm:h-24 sm:text-[15px]">
              <span>{iAgente >= 0 ? escrito(iAgente) : "Tocá play para escuchar una llamada real con el agente."}{iAgente === activa && empezo && cursor}</span>
            </p>
          </div>
        </div>

        {/* Orbe central con play. */}
        <div className="order-1 flex flex-col items-center lg:order-2">
          <button
            type="button"
            onClick={r.alternar}
            disabled={!disponible}
            aria-label={etiqueta}
            aria-pressed={r.sonando}
            className={`group relative grid h-28 w-28 place-items-center rounded-full outline-none focus-visible:ring-4 focus-visible:ring-white/90 disabled:cursor-default sm:h-40 sm:w-40 lg:h-48 lg:w-48 lg:[@media(max-height:760px)]:h-40 lg:[@media(max-height:760px)]:w-40 ${r.sonando ? "turnia-sonando" : ""}`}
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
                boxShadow: "inset 0 -14px 34px rgba(6, 22, 90, .45), inset 0 12px 26px rgba(255, 255, 255, .32), 0 24px 60px rgba(33, 87, 225, .35)",
                filter: hablaPaciente ? "hue-rotate(28deg) saturate(.9)" : "none",
              }}
            />
            <span aria-hidden="true" className="absolute left-[16%] top-[5%] h-[42%] w-[68%] rounded-full" style={{ background: "radial-gradient(ellipse at 50% 28%, rgba(255,255,255,.5) 0%, rgba(255,255,255,.12) 45%, rgba(255,255,255,0) 72%)" }} />
            {r.sonando || r.tiempo > 0 ? (
              <span aria-hidden="true" className="relative flex h-12 items-center gap-[5px]">
                {BARRAS.map((alto, i) => (
                  <span key={i} className="turnia-barra w-[3px] rounded-full bg-white/95" style={{ height: `${Math.round(alto * 44)}px`, animationDelay: `${(i * -0.17).toFixed(2)}s` }} />
                ))}
              </span>
            ) : (
              <IconoPlay sonando={false} className="relative ml-1 h-10 w-10 text-white" />
            )}
          </button>
          <p className="mt-3 text-sm font-medium text-brand-950/70">
            {r.sonando ? "Escuchando…" : r.tiempo > 0 ? "En pausa" : conAudio ? "Escuchar la llamada" : "Ver la conversación"}
            <span className="tabular-nums text-brand-950/65"> · {disponible ? `${formatearTiempo(r.tiempo)} / ${formatearTiempo(r.duracion)}` : "…"}</span>
          </p>
        </div>

        {/* Paciente: lo que dice y los datos detectados. */}
        <div className={`order-3 space-y-3 transition-opacity duration-500 ${empezo && !hablaPaciente ? "lg:opacity-60" : ""}`}>
          {dato && (
            <div key={`d${dato.linea}`} className={`turnia-entra lg:ml-auto lg:max-w-[85%] ${tarjeta} px-4 py-2.5`}>
              <p className="text-[11px] font-semibold uppercase tracking-wide text-brand-950">{dato.valor.etiqueta}</p>
              <p className="min-h-5 text-sm text-brand-950/70">{datoEscrito}</p>
            </div>
          )}
          <div className={`${tarjeta} ${hablaPaciente ? "ring-2 ring-[#7b6cf6]/40" : ""}`}>
            <p className="text-[11px] font-semibold uppercase tracking-wide text-[#6b5ce7]">Paciente</p>
            <p className="mt-1.5 flex h-[4.6rem] flex-col justify-end overflow-hidden text-[14px] leading-relaxed text-brand-950 sm:h-24 sm:text-[15px]">
              <span>{iPaciente >= 0 ? escrito(iPaciente) : "Jorge llama para sacar un turno y renovar una receta."}{iPaciente === activa && empezo && cursor}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-3">
        {disponible && <BarraProgreso r={r} className="flex-1" acento="accent-brand-600" claro />}
        <button type="button" onClick={() => setVerTodo((v) => !v)} aria-expanded={verTodo} className="shrink-0 rounded-full bg-white/70 px-3 py-1.5 text-xs font-medium text-brand-950 ring-1 ring-white hover:bg-white">
          {verTodo ? "Ocultar transcripción" : "Transcripción completa"}
        </button>
        <button type="button" onClick={r.alternar} disabled={!disponible} aria-label={etiqueta} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-white/70 text-brand-950 ring-1 ring-white hover:bg-white disabled:opacity-60">
          <IconoPlay sonando={r.sonando} className="h-4 w-4" />
        </button>
      </div>
      {verTodo && <Transcripcion conversacion={conversacion} r={r} className="mt-3 max-h-56 rounded-2xl bg-white/55 p-3 ring-1 ring-white/80 backdrop-blur" />}
    </div>
  );
}

function VarianteTarjeta({ conversacion, r }: { conversacion: Conversacion; r: Reproductor }) {
  const [abierta, setAbierta] = useState(false);
  const colores = COLORES[conversacion.color];
  const disponible = r.estado !== "cargando";
  const conAudio = r.estado === "listo";
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
          <h2 className="min-w-0 self-center text-xl font-semibold tracking-tight text-brand-900 sm:self-end sm:text-[28px] sm:leading-tight">
            {conversacion.titulo}
          </h2>
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
            <p className="font-semibold text-brand-900">{r.sonando ? "Pausar" : conAudio ? "Escuchar demo" : "Ver demo"}</p>
            <p className="text-sm tabular-nums text-brand-900/60">
              {disponible
                ? r.sonando || r.tiempo > 0
                  ? `${formatearTiempo(r.tiempo)} / ${formatearTiempo(r.duracion)}`
                  : conAudio
                    ? formatearTiempo(r.duracion)
                    : `≈ ${conversacion.duracionEstimada}`
                : "…"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 sm:pl-[112px]">
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
  const puedeSaltar = r.estado !== "cargando";

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
            <span className={`mb-0.5 block text-[11px] font-semibold uppercase tracking-wide ${esAgente ? "text-brand-600" : "text-white/90"}`}>
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
