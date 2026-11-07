"use client";

import { useEffect, useId, useRef } from "react";
import type { EstadoOrbe } from "./orbe-voz";

// La esfera de la demo personal (/p/<código>): negra como la de la serie Dark, con materia que gira
// adentro, humo alrededor y un latido de corazón (dos golpes, una pausa). En cada latido sale una onda
// y se le prende la luz de adentro. En la llamada, la luz y el tamaño siguen la voz (la de Sofi cuando
// habla, la tuya cuando te escucha), con ganancia automática como la esfera de siempre (orbe-voz.tsx).
// Se anima con requestAnimationFrame escribiendo estilos directo, sin volver a renderizar React.

/** Color de la luz de adentro: azul en reposo, violeta al conectar o cuando hablás, celeste cuando habla Sofi. */
const LUZ: Record<EstadoOrbe, string> = {
  inactiva: "92,118,255",
  conectando: "150,110,255",
  habla: "120,225,255",
  escucha: "176,132,255",
};

/**
 * Humo: anillos finos y oscuros pegados al borde, deshilachados con un filtro de turbulencia (SVG):
 * parecen hilos de materia que salen de la esfera. Giran en sentidos contrarios; el filtro se calcula
 * una vez y lo que se anima es el giro, que no cuesta. El borde de la esfera cae en r 54 (de 100).
 */
const HUMO = [
  { radio: 55.5, grosor: 2.2, semilla: 11, frecuencia: 0.07, desvio: 18, difuso: 0.6, vel: -0.08, opacidad: 0.32 },
  { radio: 56, grosor: 7, semilla: 3, frecuencia: 0.035, desvio: 26, difuso: 1.8, vel: 0.05, opacidad: 0.34 },
  { radio: 59, grosor: 14, semilla: 27, frecuencia: 0.022, desvio: 38, difuso: 3.2, vel: 0.03, opacidad: 0.14 },
];

/** Un latido: dos golpes (el segundo más suave) y una pausa. φ va de 0 a 1 en cada período. */
function latido(fase: number): number {
  const golpe = (centro: number, ancho: number) => Math.exp(-(((fase - centro) / ancho) ** 2));
  return golpe(0.05, 0.045) + 0.6 * golpe(0.25, 0.05);
}

export function EsferaOscura({ estado, leerVolumen, className = "" }: { estado: EstadoOrbe; leerVolumen?: () => number; className?: string }) {
  const cuerpo = useRef<HTMLSpanElement>(null);
  const sombra = useRef<HTMLSpanElement>(null);
  const luz = useRef<HTMLSpanElement>(null);
  const materia = useRef<(HTMLSpanElement | null)[]>([]);
  const humo = useRef<(HTMLSpanElement | null)[]>([]);
  const ondas = useRef<(HTMLSpanElement | null)[]>([]);
  // El bucle lee el estado y el volumen por referencia: así no se reinicia al cambiar.
  const estadoRef = useRef(estado);
  const leerRef = useRef(leerVolumen);
  useEffect(() => {
    estadoRef.current = estado;
    leerRef.current = leerVolumen;
  });

  useEffect(() => {
    // Con «reducir movimiento» queda quieta: se pinta una sola vez.
    const quieta = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let antes = performance.now();
    let giro = 0;
    let fase = 0;
    let nivel = 0;
    let piso = 0;
    let pico = 0.05;
    let onda = 0;
    let golpeAnterior = false;
    const pintar = (ahora: number) => {
      const dt = Math.min(0.05, (ahora - antes) / 1000);
      antes = ahora;
      const est = estadoRef.current;
      const leer = leerRef.current;
      const enLlamada = est === "habla" || est === "escucha";

      // Volumen relativo (0 a 1): se ajusta al parlante y al micrófono de cada uno.
      let objetivo = 0;
      if (leer && enLlamada) {
        const crudo = leer();
        piso = crudo < piso ? crudo : piso + (crudo - piso) * 0.002;
        pico = crudo > pico ? crudo : pico + (crudo - pico) * 0.01;
        const relativo = Math.min(1, Math.max(0, (crudo - piso) / Math.max(pico - piso, 0.04)));
        objetivo = crudo < 0.01 ? 0 : Math.pow(relativo, 0.7);
      }
      nivel += (objetivo - nivel) * (objetivo > nivel ? 0.5 : 0.16);

      // El corazón: tranquilo en reposo, agitado mientras conecta, apenas presente en la llamada.
      const periodo = est === "conectando" ? 0.62 : enLlamada ? 1.4 : 1.15;
      fase = (fase + dt / periodo) % 1;
      const pulso = latido(fase) * (enLlamada ? 0.35 : 1);
      // Una onda por cada primer golpe.
      const golpe = fase < 0.1;
      if (golpe && !golpeAnterior && !enLlamada) {
        const el = ondas.current[onda % ondas.current.length];
        el?.animate(
          [
            { transform: "scale(1)", opacity: est === "conectando" ? 0.5 : 0.38 },
            { transform: "scale(1.55)", opacity: 0 },
          ],
          { duration: 1600, easing: "cubic-bezier(.15,.6,.3,1)" },
        );
        onda += 1;
      }
      golpeAnterior = golpe;

      giro += dt * ((est === "conectando" ? 1.6 : est === "inactiva" ? 0.45 : 0.7) + nivel * 2.2);
      const flota = Math.sin(ahora / 1700) * 1.2;
      const escala = 1 + pulso * 0.055 + nivel * (est === "habla" ? 0.13 : 0.09);
      if (cuerpo.current) cuerpo.current.style.transform = `translateY(${flota.toFixed(2)}%) scale(${escala.toFixed(4)})`;
      if (sombra.current) {
        sombra.current.style.transform = `translateX(-50%) scale(${(1 - flota * 0.02 + pulso * 0.04).toFixed(3)})`;
        sombra.current.style.opacity = (0.5 - flota * 0.04).toFixed(3);
      }
      if (luz.current) {
        const prendida = enLlamada ? 0.16 + nivel * 0.84 : est === "conectando" ? 0.3 + pulso * 0.4 : 0.1 + pulso * 0.42;
        luz.current.style.opacity = prendida.toFixed(3);
        luz.current.style.transform = `scale(${(0.85 + nivel * 0.35 + pulso * 0.1).toFixed(3)})`;
      }
      materia.current.forEach((el, i) => {
        if (el) el.style.transform = `rotate(${((i ? -giro * 0.7 : giro) * 57.3).toFixed(2)}deg)`;
      });
      humo.current.forEach((el, i) => {
        if (!el) return;
        const h = HUMO[i];
        const crece = 1 + pulso * 0.05 + nivel * 0.1;
        el.style.transform = `rotate(${(giro * h.vel * 57.3 * 6).toFixed(2)}deg) scale(${crece.toFixed(4)})`;
      });
      if (!quieta) raf = requestAnimationFrame(pintar);
    };
    pintar(antes);
    return () => cancelAnimationFrame(raf);
  }, []);

  const tono = LUZ[estado];
  const id = useId().replace(/:/g, "");
  return (
    <span aria-hidden="true" className={`relative block [container-type:inline-size] ${className}`}>
      {/* La sombra en el piso: la esfera flota. */}
      <span
        ref={sombra}
        className="absolute left-1/2 top-[104%] h-[9%] w-[62%] rounded-[50%] opacity-50 blur-[2.5cqw]"
        style={{ background: "radial-gradient(closest-side, rgba(8,10,24,.55), rgba(8,10,24,0))", transform: "translateX(-50%)" }}
      />
      <span ref={cuerpo} className="absolute inset-0 will-change-transform">
        {/* Humo: hilos oscuros que salen de la esfera y giran despacio. */}
        {HUMO.map((h, i) => (
          <span
            key={i}
            ref={(el) => {
              humo.current[i] = el;
            }}
            className="absolute -inset-[42%] will-change-transform"
            style={{ opacity: h.opacidad }}
          >
            <svg viewBox="-100 -100 200 200" className="h-full w-full overflow-visible">
              <defs>
                <filter id={`${id}-f${i}`} x="-30%" y="-30%" width="160%" height="160%">
                  <feTurbulence type="fractalNoise" baseFrequency={h.frecuencia} numOctaves={2} seed={h.semilla} result="ruido" />
                  <feDisplacementMap in="SourceGraphic" in2="ruido" scale={h.desvio} xChannelSelector="R" yChannelSelector="G" />
                  <feGaussianBlur stdDeviation={h.difuso} />
                </filter>
              </defs>
              <circle r={h.radio} fill="none" stroke="#0b0e26" strokeWidth={h.grosor} filter={`url(#${id}-f${i})`} />
            </svg>
          </span>
        ))}
        {/* Las ondas de cada latido. */}
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            ref={(el) => {
              ondas.current[i] = el;
            }}
            className="absolute inset-0 rounded-full opacity-0"
            style={{ boxShadow: "0 0 0 0.45cqw rgba(16,20,44,.55), 0 0 5cqw 0.6cqw rgba(60,70,160,.18)" }}
          />
        ))}
        {/* La esfera: vidrio negro con materia que gira y una luz que late adentro. */}
        <span
          className="absolute inset-0 isolate overflow-hidden rounded-full [mask-image:radial-gradient(white,black)]"
          style={{ background: "radial-gradient(circle at 50% 38%, #1a1e36 0%, #0a0c18 48%, #020308 100%)" }}
        >
          {[0, 1].map((i) => (
            <span
              key={i}
              ref={(el) => {
                materia.current[i] = el;
              }}
              className={`absolute rounded-full mix-blend-screen will-change-transform ${i ? "inset-[14%] opacity-50" : "-inset-[12%] opacity-60"}`}
              style={{
                background: i
                  ? "conic-gradient(from 90deg, rgba(0,0,0,0) 0deg, rgba(150,95,235,.55) 70deg, rgba(0,0,0,0) 150deg, rgba(60,110,255,.4) 250deg, rgba(0,0,0,0) 330deg)"
                  : "conic-gradient(from 0deg, rgba(0,0,0,0) 0deg, rgba(55,80,210,.55) 60deg, rgba(0,0,0,0) 140deg, rgba(110,70,210,.45) 220deg, rgba(0,0,0,0) 300deg)",
                filter: "blur(5cqw)",
              }}
            />
          ))}
          <span
            ref={luz}
            className="absolute inset-0 rounded-full opacity-10 mix-blend-screen transition-[background] duration-700"
            style={{ background: `radial-gradient(circle at 50% 56%, rgba(${tono},.95) 0%, rgba(${tono},.42) 26%, rgba(${tono},0) 60%)` }}
          />
          {/* Borde con luz y sombra abajo: se lee como una esfera de vidrio. */}
          <span className="absolute inset-0 rounded-full shadow-[inset_0_0_0_0.35cqw_rgba(170,185,255,.16),inset_0_-8cqw_14cqw_-4cqw_rgba(0,0,0,.7),inset_0_4cqw_10cqw_-3cqw_rgba(150,170,255,.22)]" />
          <span
            className="absolute left-[22%] top-[9%] h-[22%] w-[40%] -rotate-12 rounded-[50%]"
            style={{ background: "radial-gradient(closest-side, rgba(255,255,255,.34), rgba(255,255,255,.06) 60%, rgba(255,255,255,0))" }}
          />
        </span>
      </span>
    </span>
  );
}
