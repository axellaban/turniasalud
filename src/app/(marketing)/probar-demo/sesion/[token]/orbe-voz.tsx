"use client";

import { useEffect, useRef } from "react";

// Esfera de la llamada, al estilo del modo de voz de ChatGPT: nubes que giran adentro de una esfera
// celeste y que se aceleran y crecen con la voz (la de Sofi cuando habla, la tuya cuando te escucha).
// Se anima con requestAnimationFrame escribiendo estilos directo, sin volver a renderizar React.

export type EstadoOrbe = "inactiva" | "conectando" | "habla" | "escucha";

/** Nubes de adentro: tamaño y radio del recorrido (fracción de la esfera), velocidad y fase. */
const NUBES = [
  { color: "#2350d6", tam: 0.9, radio: 0.22, vel: 0.23, fase: 3.3, opacidad: 0.6 },
  { color: "#618df3", tam: 0.8, radio: 0.27, vel: -0.31, fase: 0.6, opacidad: 0.8 },
  { color: "#ffffff", tam: 0.62, radio: 0.26, vel: 0.36, fase: 2.4, opacidad: 0.95 },
  { color: "#cce6ff", tam: 0.7, radio: 0.3, vel: -0.29, fase: 4.4, opacidad: 0.95 },
  { color: "#ffffff", tam: 0.45, radio: 0.33, vel: -0.44, fase: 1.2, opacidad: 0.85 },
  { color: "#32d5d8", tam: 0.5, radio: 0.3, vel: 0.42, fase: 5.1, opacidad: 0.4 },
  { color: "#b3b1ff", tam: 0.42, radio: 0.32, vel: -0.5, fase: 0.2, opacidad: 0.45 },
];

/** Transformación de cada nube según el tiempo acumulado y el nivel de la voz (0 a 1). */
function posicion(i: number, tiempo: number, nivel: number): string {
  const n = NUBES[i];
  const a = n.fase + tiempo * n.vel;
  const r = n.radio * (1 + nivel * 0.25);
  const x = Math.cos(a) * r * 100;
  const y = Math.sin(a * 1.3 + n.fase) * r * 90;
  const s = 1 + nivel * 0.18 * Math.sin(a * 2);
  return `translate(-50%, -50%) translate(${x.toFixed(2)}cqw, ${y.toFixed(2)}cqw) scale(${s.toFixed(3)})`;
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
  const nubes = useRef<(HTMLSpanElement | null)[]>([]);
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
    const pintar = (ahora: number) => {
      const dt = Math.min(0.05, (ahora - antes) / 1000);
      antes = ahora;
      const est = estadoRef.current;
      const leer = leerRef.current;
      const enLlamada = est === "habla" || est === "escucha";
      const objetivo = leer && enLlamada ? Math.min(1, leer() * (est === "habla" ? 2.6 : 2.2)) : 0;
      // Sube rápido y baja despacio, como un vúmetro.
      nivel += (objetivo - nivel) * (objetivo > nivel ? 0.22 : 0.06);
      tiempo += dt * ((est === "conectando" ? 1.8 : est === "inactiva" ? 0.7 : 1) + nivel * 3.2);
      const respira = Math.sin(ahora / 700) * (est === "inactiva" ? 0.02 : 0.012);
      const crece = nivel * (est === "habla" ? 0.13 : 0.07);
      if (esfera.current) esfera.current.style.transform = `scale(${(1 + respira + crece).toFixed(4)})`;
      if (halo.current) {
        halo.current.style.opacity = (0.35 + nivel * 0.65).toFixed(3);
        halo.current.style.transform = `scale(${(1 + nivel * 0.3).toFixed(3)})`;
      }
      nubes.current.forEach((el, i) => {
        if (el) el.style.transform = posicion(i, tiempo, nivel);
      });
      if (!quieta) raf = requestAnimationFrame(pintar);
    };
    pintar(antes);
    return () => cancelAnimationFrame(raf);
  }, []);

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
        className="absolute -inset-[18%] rounded-full opacity-35"
        style={{ background: "radial-gradient(circle, rgba(97,141,243,.55) 0%, rgba(97,141,243,.18) 45%, rgba(97,141,243,0) 70%)" }}
      />
      {estado === "conectando" && (
        <span
          className="orbe-giro absolute -inset-[7%] rounded-full"
          style={{
            background: "conic-gradient(from 0deg, rgba(97,141,243,0) 0deg, rgba(97,141,243,0) 200deg, #618df3 300deg, #2157e1 360deg)",
            WebkitMask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
            mask: "radial-gradient(farthest-side, transparent calc(100% - 3px), #000 calc(100% - 2px))",
          }}
        />
      )}
      <span
        ref={esfera}
        className="absolute inset-0 rounded-full shadow-[0_20px_60px_rgb(33_87_225/0.35)] [clip-path:circle(50%)]"
        style={{ background: "radial-gradient(circle at 50% 18%, #eef5ff 0%, #a9c8ff 34%, #4f7fef 72%, #2a55d8 100%)" }}
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
              background: `radial-gradient(circle, ${n.color} 0%, ${n.color}00 68%)`,
              filter: "blur(5cqw)",
              transform: posicion(i, 0, 0),
            }}
          />
        ))}
        {/* Volumen: sombra abajo, luz arriba y un brillo suave, para que se lea como esfera. */}
        <span className="absolute inset-0 rounded-full shadow-[inset_0_-10cqw_18cqw_-6cqw_rgb(8_24_63/0.25),inset_0_6cqw_14cqw_-4cqw_rgb(255_255_255/0.6)]" />
        <span
          className="absolute left-[18%] top-[4%] h-[36%] w-[64%]"
          style={{ background: "radial-gradient(closest-side, rgba(255,255,255,.5), rgba(255,255,255,.12) 55%, rgba(255,255,255,0))" }}
        />
      </span>
    </span>
  );
}
