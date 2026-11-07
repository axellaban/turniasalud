"use client";

import { useEffect, useRef } from "react";
import type { EstadoOrbe } from "./orbe-voz";

// La esfera de la demo personal (/p/<código>): un cielo azul Turnia con nubes blancas que fluyen
// adentro y un toque aqua abajo, sin latidos. Las nubes se dibujan con un shader (WebGL): ruido
// fractal deformado sobre sí mismo, que se mueve despacio en reposo y más rápido cuando hay voz.
// En la llamada crece con la voz (la de Sofi cuando habla, la tuya cuando te escucha) con ganancia
// automática, como la esfera de siempre (orbe-voz.tsx). Sin WebGL queda un degradé quieto.

/** Hasta este ancho (en píxeles reales) se dibuja el cielo: las nubes son suaves y no necesitan más. */
const MAX_PX = 560;

const VERTICE = `
attribute vec2 a;
varying vec2 v;
void main() { v = a; gl_Position = vec4(a, 0.0, 1.0); }
`;

const FRAGMENTO = `
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
varying vec2 v;
uniform float t;
uniform float px;
uniform float aqua;
uniform float luz;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}
float ruido(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float s = 0.0;
  float a = 0.5;
  mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { s += a * ruido(p); p = m * p; a *= 0.5; }
  return s;
}

void main() {
  vec2 uv = v;
  float r = length(uv);
  float borde = 1.0 - smoothstep(1.0 - px * 1.5, 1.0, r);
  if (borde <= 0.0) { gl_FragColor = vec4(0.0); return; }

  // Nubes: ruido fractal deformado dos veces, que deriva de costado y gira apenas.
  vec2 p = uv * 1.35;
  vec2 q = vec2(fbm(p + vec2(t * 0.10, 0.0)), fbm(p + vec2(3.1, 7.4 + t * 0.07)));
  vec2 w = vec2(fbm(p + 2.0 * q + vec2(1.7 - t * 0.12, 9.2)), fbm(p + 2.0 * q + vec2(8.3, 2.8 + t * 0.09)));
  float n = fbm(p * 1.5 + 1.8 * w);

  // Un horizonte ondulado en el tercio de abajo: arriba, cielo; ahí, las nubes; abajo, la luz.
  float horizonte = -0.32 + 0.12 * sin(uv.x * 1.8 + t * 0.35) + 0.3 * (q.x - 0.5);
  float d = uv.y - horizonte;
  float densidad = n + 0.5 - abs(d) * 0.85 - max(d, 0.0) * 0.55;
  float nube = smoothstep(0.5, 0.92, densidad);

  vec3 arriba = vec3(0.129, 0.341, 0.882);  // #2157e1, el azul de Turnia
  vec3 medio = vec3(0.231, 0.439, 0.918);   // #3b70ea
  vec3 abajo = vec3(0.800, 0.902, 1.0);     // #cce6ff, cielo
  vec3 verde = vec3(0.196, 0.835, 0.847);   // #32d5d8, aqua: la salud
  vec3 cielo = mix(abajo, medio, smoothstep(-0.8, 0.15, d));
  cielo = mix(cielo, arriba, smoothstep(0.15, 1.0, d));
  // Un velo aqua abajo, que se mueve con las nubes.
  cielo = mix(cielo, verde, smoothstep(0.0, -0.75, d) * (0.25 + 0.45 * n) * aqua);

  vec3 color = mix(cielo, vec3(0.985, 0.99, 1.0), nube);
  // La parte de abajo de cada nube, apenas más azul: le da volumen.
  color = mix(color, color * vec3(0.9, 0.94, 1.0), nube * smoothstep(0.62, 0.35, n));
  // Con la voz, el cielo se aclara un poco.
  color = mix(color, vec3(1.0), luz * 0.12 * (1.0 - nube));
  color *= 1.0 - 0.05 * r * r;
  gl_FragColor = vec4(color * borde, borde);
}
`;

function shader(gl: WebGLRenderingContext, tipo: number, fuente: string) {
  const s = gl.createShader(tipo)!;
  gl.shaderSource(s, fuente);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? "shader");
  return s;
}

export function EsferaCielo({
  estado,
  leerVolumen,
  className = "",
  children,
}: {
  estado: EstadoOrbe;
  leerVolumen?: () => number;
  className?: string;
  /** Lo que va escrito adentro (en cqw, relativo al ancho de la esfera). */
  children?: React.ReactNode;
}) {
  const lienzo = useRef<HTMLCanvasElement>(null);
  const cuerpo = useRef<HTMLSpanElement>(null);
  // El bucle lee el estado y el volumen por referencia: así no se reinicia al cambiar.
  const estadoRef = useRef(estado);
  const leerRef = useRef(leerVolumen);
  useEffect(() => {
    estadoRef.current = estado;
    leerRef.current = leerVolumen;
  });

  useEffect(() => {
    const canvas = lienzo.current;
    const gl = canvas?.getContext("webgl", { alpha: true, premultipliedAlpha: true, antialias: false });
    if (!canvas || !gl) return; // sin WebGL queda el degradé del fondo
    let programa: WebGLProgram;
    try {
      programa = gl.createProgram()!;
      gl.attachShader(programa, shader(gl, gl.VERTEX_SHADER, VERTICE));
      gl.attachShader(programa, shader(gl, gl.FRAGMENT_SHADER, FRAGMENTO));
      gl.linkProgram(programa);
      if (!gl.getProgramParameter(programa, gl.LINK_STATUS)) return;
    } catch {
      return;
    }
    gl.useProgram(programa);
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const a = gl.getAttribLocation(programa, "a");
    gl.enableVertexAttribArray(a);
    gl.vertexAttribPointer(a, 2, gl.FLOAT, false, 0, 0);
    const u = {
      t: gl.getUniformLocation(programa, "t"),
      px: gl.getUniformLocation(programa, "px"),
      aqua: gl.getUniformLocation(programa, "aqua"),
      luz: gl.getUniformLocation(programa, "luz"),
    };
    canvas.dataset.listo = "1";

    const medir = () => {
      const ancho = Math.max(1, Math.round(Math.min(canvas.clientWidth * Math.min(window.devicePixelRatio || 1, 2), MAX_PX)));
      if (canvas.width !== ancho) {
        canvas.width = ancho;
        canvas.height = ancho;
        gl.viewport(0, 0, ancho, ancho);
      }
      gl.uniform1f(u.px, 2 / ancho);
    };
    const observador = new ResizeObserver(medir);
    observador.observe(canvas);
    medir();

    // Con «reducir movimiento» queda quieta: se pinta una sola vez.
    const quieta = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let antes = performance.now();
    // Arranca en un momento cualquiera: cada visita ve otras nubes.
    let tiempo = Math.random() * 100;
    let nivel = 0;
    let piso = 0;
    let pico = 0.05;
    let aqua = 0.6;
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
      nivel += (objetivo - nivel) * (objetivo > nivel ? 0.35 : 0.08);
      // Cuando te escucha, el velo aqua sube.
      aqua += ((est === "escucha" ? 1 : 0.6) - aqua) * 0.04;

      tiempo += dt * ((est === "conectando" ? 2.2 : est === "inactiva" ? 1 : 1.2) + nivel * 2.4);
      gl.uniform1f(u.t, tiempo);
      gl.uniform1f(u.aqua, aqua);
      gl.uniform1f(u.luz, nivel);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      if (cuerpo.current) cuerpo.current.style.transform = `scale(${(1 + nivel * (est === "habla" ? 0.12 : 0.08)).toFixed(4)})`;
      if (!quieta) raf = requestAnimationFrame(pintar);
    };
    pintar(antes);
    return () => {
      cancelAnimationFrame(raf);
      observador.disconnect();
      // Sin perder el contexto: si React vuelve a montar la esfera sobre el mismo lienzo, lo reusa.
      gl.deleteBuffer(buffer);
      gl.deleteProgram(programa);
    };
  }, []);

  return (
    <span aria-hidden="true" className={`relative block [container-type:inline-size] ${className}`}>
      <span ref={cuerpo} className="absolute inset-0 will-change-transform">
        <span
          className="absolute inset-0 overflow-hidden rounded-full shadow-[0_3cqw_9cqw_-3cqw_rgba(33,87,225,.35)]"
          style={{ background: "linear-gradient(180deg, #2157e1 0%, #3b70ea 45%, #f4f8ff 66%, #cce6ff 82%, #8fe3e6 100%)" }}
        >
          <canvas ref={lienzo} className="absolute inset-0 h-full w-full" />
        </span>
        {children && <span className="absolute inset-0 grid place-items-center text-center">{children}</span>}
      </span>
    </span>
  );
}
