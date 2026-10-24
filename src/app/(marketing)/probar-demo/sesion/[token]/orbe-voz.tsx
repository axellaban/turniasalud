"use client";

import { useEffect, useRef } from "react";

// Esfera de la llamada, al estilo del modo de voz de ChatGPT: nubes de colores que giran adentro y una
// forma que late. Reacciona a la voz (la de Sofi cuando habla, la tuya cuando te escucha) con ganancia
// automática: se ajusta al volumen de cada parlante y micrófono, así se mueve con cada sílaba.
// Se anima con requestAnimationFrame escribiendo estilos directo, sin volver a renderizar React.

export type EstadoOrbe = "inactiva" | "conectando" | "habla" | "escucha";

type Nube = { color: string; tam: number; radio: number; vel: number; fase: number; opacidad: number; luz?: boolean };

/** Nubes de adentro: tamaño y radio del recorrido (fracción de la esfera), velocidad, fase y si suman luz. */
const NUBES: Nube[] = [
  { color: "#1a2bb5", tam: 0.95, radio: 0.2, vel: 0.23, fase: 3.3, opacidad: 0.75 },
  { color: "#2ee6ff", tam: 0.72, radio: 0.28, vel: -0.31, fase: 0.6, opacidad: 0.9, luz: true },
  { color: "#8f6bff", tam: 0.76, radio: 0.3, vel: 0.36, fase: 2.4, opacidad: 0.85, luz: true },
  { color: "#ffffff", tam: 0.5, radio: 0.27, vel: -0.29, fase: 4.4, opacidad: 0.85, luz: true },
  { color: "#4f8bff", tam: 0.7, radio: 0.33, vel: -0.44, fase: 1.2, opacidad: 0.8 },
  { color: "#ff7ad9", tam: 0.42, radio: 0.32, vel: 0.5, fase: 5.1, opacidad: 0.55, luz: true },
];

/** Color del halo y de las ondas: cian cuando habla Sofi, violeta cuando habla el paciente. */
const TONO: Record<EstadoOrbe, string> = {
  inactiva: "79,139,255",
  conectando: "79,139,255",
  habla: "46,230,255",
  escucha: "143,107,255",
};

/** Transformación de cada nube según el tiempo acumulado y el nivel de la voz (0 a 1). */
function posicion(i: number, tiempo: number, nivel: number): string {
  const n = NUBES[i];
  const a = n.fase + tiempo * n.vel;
  const r = n.radio * (1 + nivel * 0.6);
  const x = Math.cos(a) * r * 100;
  const y = Math.sin(a * 1.3 + n.fase) * r * 90;
  const s = 1 + nivel * 0.35 * Math.sin(a * 2);
  return `translate(-50%, -50%) translate(${x.toFixed(2)}cqw, ${y.toFixed(2)}cqw) scale(${s.toFixed(3)})`;
}

/** Forma de la esfera: cada esquina oscila alrededor del círculo; con la voz, late como una gota. */
function forma(t: number, amplitud: number): string {
  const r = (k: number, f: number) => `${(50 + Math.sin(t * k + f) * amplitud).toFixed(1)}%`;
  return `${r(1.3, 0)} ${r(1.7, 1.1)} ${r(1.1, 2.3)} ${r(1.9, 3.7)} / ${r(1.5, 4.2)} ${r(1.2, 5.3)} ${r(1.8, 0.7)} ${r(1.4, 2.9)}`;
}

const CSS = `
@keyframes orbe-gira { to { transform: rotate(360deg) } }
@keyframes orbe-anillo { from { transform: scale(1); opacity: .55 } to { transform: scale(1.6); opacity: 0 } }
.orbe-giro { animation: orbe-gira 1.1s linear infinite }
.orbe-anillo { animation: orbe-anillo 2.8s cubic-bezier(.2,.6,.3,1) infinite }
`;

export function OrbeVoz({ estado, leerVolumen, className = "" }: { estado: EstadoOrbe; leerVolumen?: () => number; className?: string }) {
  const esfera = useRef<HTMLSpanElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  const brillo = useRef<HTMLSpanElement>(null);
  const nubes = useRef<(HTMLSpanElement | null)[]>([]);
  const ondas = useRef<(HTMLSpanElement | null)[]>([]);
  // El bucle de animación lee el estado y el volumen por referencia: así no se reinicia al cambiar.
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
    let tiempo = 0;
    let nivel = 0;
    let lento = 0;
    // Ganancia automática: piso (ruido de fondo) y pico (lo más fuerte reciente) del volumen.
    let piso = 0;
    let pico = 0.05;
    let ultimaOnda = 0;
    let onda = 0;
    const pintar = (ahora: number) => {
      const dt = Math.min(0.05, (ahora - antes) / 1000);
      antes = ahora;
      const est = estadoRef.current;
      const leer = leerRef.current;
      const enLlamada = est === "habla" || est === "escucha";

      let objetivo = 0;
      if (leer && enLlamada) {
        const crudo = leer();
        piso = crudo < piso ? crudo : piso + (crudo - piso) * 0.002;
        pico = crudo > pico ? crudo : pico + (crudo - pico) * 0.01;
        const relativo = Math.min(1, Math.max(0, (crudo - piso) / Math.max(pico - piso, 0.04)));
        objetivo = crudo < 0.01 ? 0 : Math.pow(relativo, 0.7) * (est === "habla" ? 1 : 0.85);
      }
      // Sube rápido y baja bastante rápido: sigue las sílabas en lugar de quedarse arriba.
      nivel += (objetivo - nivel) * (objetivo > nivel ? 0.5 : 0.18);
      lento += (nivel - lento) * 0.05;

      tiempo += dt * ((est === "conectando" ? 2.2 : est === "inactiva" ? 0.7 : 1) + nivel * 7);
      const respira = Math.sin(ahora / 700) * (est === "inactiva" ? 0.025 : 0.015);
      const crece = nivel * (est === "habla" ? 0.28 : 0.2);
      if (esfera.current) {
        esfera.current.style.transform = `scale(${(1 + respira + crece).toFixed(4)})`;
        esfera.current.style.borderRadius = forma(tiempo * 1.6, 1.5 + nivel * 5.5);
      }
      if (halo.current) {
        halo.current.style.opacity = (0.4 + nivel * 0.6).toFixed(3);
        halo.current.style.transform = `scale(${(1 + nivel * 0.6).toFixed(3)})`;
      }
      if (brillo.current) brillo.current.style.opacity = (nivel * 0.6).toFixed(3);
      nubes.current.forEach((el, i) => {
        if (el) el.style.transform = posicion(i, tiempo, nivel);
      });
      // Una onda que sale de la esfera en cada golpe de voz.
      if (enLlamada && nivel - lento > 0.28 && ahora - ultimaOnda > 280) {
        const el = ondas.current[onda % ondas.current.length];
        el?.animate([{ transform: "scale(1)", opacity: 0.85 }, { transform: "scale(1.7)", opacity: 0 }], { duration: 1000, easing: "cubic-bezier(.2,.6,.3,1)" });
        onda += 1;
        ultimaOnda = ahora;
      }
      if (!quieta) raf = requestAnimationFrame(pintar);
    };
    pintar(antes);
    return () => cancelAnimationFrame(raf);
  }, []);

  const tono = TONO[estado];
  return (
    <span aria-hidden="true" className={`relative block [container-type:inline-size] ${className}`}>
      <style href="turnia-orbe-voz" precedence="medium">
        {CSS}
      </style>
      {estado === "inactiva" && (
        <>
          <span className="orbe-anillo absolute inset-0 rounded-full border-2 border-brand-400/50" />
          <span className="orbe-anillo absolute inset-0 rounded-full border-2 border-brand-400/40 [animation-delay:1.4s]" />
        </>
      )}
      <span
        ref={halo}
        className="absolute -inset-[30%] rounded-full opacity-40"
        style={{ background: `radial-gradient(circle, rgba(${tono},.55) 0%, rgba(${tono},.2) 40%, rgba(${tono},0) 68%)` }}
      />
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          ref={(el) => {
            ondas.current[i] = el;
          }}
          className="absolute inset-0 rounded-full opacity-0"
          style={{ boxShadow: `0 0 0 2px rgba(${tono},.6), 0 0 24px 4px rgba(${tono},.35)` }}
        />
      ))}
      {estado === "conectando" && (
        <span
          className="orbe-giro absolute -inset-[7%] rounded-full"
          style={{
            background: "conic-gradient(from 0deg, rgba(46,230,255,0) 0deg, rgba(46,230,255,0) 200deg, #2ee6ff 290deg, #8f6bff 360deg)",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          }}
        />
      )}
      {/* La máscara opaca fuerza a Safari a recortar las nubes con el borde que late. */}
      <span
        ref={esfera}
        className="absolute inset-0 isolate overflow-hidden rounded-full transition-[filter] duration-700 [mask-image:radial-gradient(white,black)]"
        style={{
          background: "radial-gradient(circle at 50% 28%, #8fe3ff 0%, #4a86ff 32%, #2b45dc 66%, #17208f 100%)",
          // Cuando habla el paciente, el color se corre hacia el violeta.
          filter: estado === "escucha" ? "hue-rotate(28deg) saturate(1.1)" : "none",
        }}
      >
        {NUBES.map((n, i) => (
          <span
            key={i}
            ref={(el) => {
              nubes.current[i] = el;
            }}
            className="absolute left-1/2 top-1/2 rounded-full will-change-transform"
            style={{
              width: `${n.tam * 100}%`,
              height: `${n.tam * 100}%`,
              opacity: n.opacidad,
              mixBlendMode: n.luz ? "screen" : "normal",
              background: `radial-gradient(circle, ${n.color} 0%, ${n.color}00 68%)`,
              filter: "blur(5cqw)",
              transform: posicion(i, 0, 0),
            }}
          />
        ))}
        <span
          ref={brillo}
          className="absolute inset-0 opacity-0 mix-blend-screen"
          style={{ background: "radial-gradient(circle at 50% 45%, rgba(255,255,255,.6) 0%, rgba(255,255,255,0) 62%)" }}
        />
        {/* Volumen: sombra abajo, luz arriba y un brillo suave, para que se lea como esfera. */}
        <span className="absolute inset-0 rounded-[inherit] shadow-[inset_0_-10cqw_18cqw_-6cqw_rgb(8_14_60/0.35),inset_0_6cqw_14cqw_-4cqw_rgb(255_255_255/0.55)]" />
        <span
          className="absolute left-[18%] top-[4%] h-[36%] w-[64%]"
          style={{ background: "radial-gradient(closest-side, rgba(255,255,255,.5), rgba(255,255,255,.12) 55%, rgba(255,255,255,0))" }}
        />
      </span>
    </span>
  );
}
