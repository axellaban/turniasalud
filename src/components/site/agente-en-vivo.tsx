"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Mensajes del agente que se escriben sobre el video del hero, sincronizados con
 * el momento del video: cada escena es otra persona (clips de 8 s con fundido de 0,6 s).
 * Sin video (o si no arranca), rotan solos sobre la foto.
 */
const ESCENAS = [
  { en: 0.3, texto: "Sra. García, su tratamiento de inyecciones requiere una visita cada 4 semanas. Ya va por el día 26. ¿Le confirmo el jueves a las 9:30?" },
  { en: 7.7, texto: "Veo que la semana pasada estuvo en nuestra guardia. El alta indica un control dentro de los 7 días y tengo un turno mañana con la Dra. Lin. ¿Se lo reservo?" },
  { en: 15.1, texto: "El Dr. Torres atiende hombro. Para el dolor de rodilla, su derivación corresponde al equipo de la Dra. Paz. Tengo el jueves a las 14:15." },
  { en: 22.5, texto: "Acabo de recibir su derivación a otorrino. Ya cargué su ficha, verifiqué su cobertura de OSDE y que el profesional está en cartilla. El Dr. Ramírez tiene el lunes a las 10." },
];
const VELOCIDAD_MS = 20;
const SALIDA_MS = 450;
/** Sin video: tiempo entre escenas. */
const CICLO_MS = 7400;

export function AgenteEnVivo({ videoId }: { videoId: string }) {
  const [escena, setEscena] = useState<number | null>(null);
  const [escrito, setEscrito] = useState("");
  const [saliendo, setSaliendo] = useState(false);
  const timers = useRef<number[]>([]);

  // Qué escena toca: la marca el video; si no hay video que avance, un reloj.
  useEffect(() => {
    const video = document.getElementById(videoId) as HTMLVideoElement | null;
    let raf = 0;
    let actual = -1;
    let reloj = 0;
    const mostrar = (i: number) => {
      if (i === actual) return;
      actual = i;
      setSaliendo(true);
      timers.current.push(window.setTimeout(() => { setSaliendo(false); setEscena(i); }, SALIDA_MS));
    };
    const seguirVideo = () => {
      if (video && !video.paused && video.readyState >= 2) {
        const t = video.currentTime;
        let i = -1;
        ESCENAS.forEach((e, n) => { if (t >= e.en) i = n; });
        if (i >= 0) mostrar(i);
      }
      raf = requestAnimationFrame(seguirVideo);
    };
    const usarReloj = () => {
      if (reloj) return;
      let n = 0;
      mostrar(0);
      reloj = window.setInterval(() => { n = (n + 1) % ESCENAS.length; mostrar(n); }, CICLO_MS);
    };
    const tieneVideo = Boolean(video && video.querySelector("source") && video.networkState !== HTMLMediaElement.NETWORK_NO_SOURCE);
    // Con «reducir movimiento», el video queda quieto en su primer cuadro y los mensajes rotan solos.
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (quieto) video?.pause();
    if (tieneVideo && !quieto) {
      raf = requestAnimationFrame(seguirVideo);
      // Si en 2 segundos el video no arrancó (sin archivo, ahorro de datos), rotan solos.
      timers.current.push(window.setTimeout(() => { if (!video || video.paused || video.readyState < 2) { cancelAnimationFrame(raf); usarReloj(); } }, 2000));
      video?.addEventListener("error", usarReloj, true);
    } else {
      usarReloj();
    }
    const pendientes = timers.current;
    return () => {
      cancelAnimationFrame(raf);
      clearInterval(reloj);
      pendientes.forEach(clearTimeout);
      video?.removeEventListener("error", usarReloj, true);
    };
  }, [videoId]);

  // Efecto de escritura (sin animación si la persona pidió reducir movimiento).
  useEffect(() => {
    if (escena === null) return;
    const texto = ESCENAS[escena].texto;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const id = window.setTimeout(() => setEscrito(texto), 0);
      return () => clearTimeout(id);
    }
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setEscrito(texto.slice(0, i));
      if (i >= texto.length) clearInterval(id);
    }, VELOCIDAD_MS);
    return () => clearInterval(id);
  }, [escena]);

  const escribiendo = escena !== null && escrito.length < ESCENAS[escena].texto.length;
  return (
    <div
      aria-hidden="true"
      className={`w-full max-w-[520px] rounded-2xl border border-white/25 bg-white/10 p-5 text-white shadow-2xl backdrop-blur-md transition-all duration-500 ${
        escena === null || saliendo ? "translate-y-3 opacity-0" : "translate-y-0 opacity-100"
      }`}
    >
      <p className="flex items-center gap-3 text-sm font-medium text-white/85">
        <span className="flex h-5 items-center gap-[3px]">
          {[6, 12, 18, 10, 16, 8, 13].map((h, n) => (
            <span
              key={n}
              className={`w-[2px] rounded-full bg-white/80 ${escribiendo ? "animate-[turnia-onda_0.9s_ease-in-out_infinite]" : ""}`}
              style={{ height: `${escribiendo ? h : 4}px`, animationDelay: `${n * 0.08}s` }}
            />
          ))}
        </span>
        Sofi · agente de Turnia
      </p>
      <p className="mt-3 min-h-[5.5em] text-[17px] leading-relaxed sm:text-lg">
        {escrito}
        <span className={`ml-0.5 inline-block h-[1.1em] w-[2px] translate-y-[3px] bg-white/80 ${escribiendo ? "" : "animate-pulse"}`} />
      </p>
    </div>
  );
}
