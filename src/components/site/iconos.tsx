import type { IconoClave } from "@/content/tipos";

// Íconos de línea propios (24×24, trazo de 1,6). Se pintan con currentColor.
const TRAZOS: Record<IconoClave, string[]> = {
  calendario: ["M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 10h16", "M8 3v4", "M16 3v4", "M8.5 14.5l2 2 4-4"],
  triage: ["M12 3l8 4v5c0 4.5-3.4 8.3-8 9-4.6-.7-8-4.5-8-9V7z", "M12 8v6", "M9 11h6"],
  admision: ["M5 4h10l4 4v12H5z", "M15 4v4h4", "M8 12h8", "M8 16h5"],
  luna: ["M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"],
  megafono: ["M4 10v4h3l7 4V6l-7 4z", "M17 9a4 4 0 0 1 0 6", "M7 14l1 5h2.5"],
  receta: ["M7 3h7l4 4v14H7z", "M10 10h2.5a1.75 1.75 0 0 1 0 3.5H10V10z", "M10 13.5V17", "M12 13.5l3 3.5"],
  derivacion: ["M5 6h8", "M13 6l-3-3", "M13 6l-3 3", "M19 18h-8", "M11 18l3-3", "M11 18l3 3", "M5 6v6a6 6 0 0 0 6 6"],
  pago: ["M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M3 10h18", "M7 15h3"],
  tareas: ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6l1 1 2-2", "M4 12l1 1 2-2", "M4 18l1 1 2-2"],
  hueso: ["M8 8l8 8", "M6 9.5a2.5 2.5 0 1 1 3.5-3.5 2.5 2.5 0 1 1 3.5 0", "M18 14.5a2.5 2.5 0 1 1-3.5 3.5 2.5 2.5 0 1 1-3.5 0"],
  piel: ["M12 3c3 4 6 6.5 6 10a6 6 0 0 1-12 0c0-3.5 3-6 6-10z", "M10 13h.01", "M13.5 15.5h.01", "M12.5 11h.01"],
  ojo: ["M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z", "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z"],
  mujer: ["M12 13a4.5 4.5 0 1 0 0-9 4.5 4.5 0 0 0 0 9z", "M12 13v8", "M9 18h6"],
  bebe: ["M12 21a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 5c0-1.2.8-2 2-2", "M9.5 12h.01", "M14.5 12h.01", "M10 15.5a3 3 0 0 0 4 0"],
  estetoscopio: ["M6 3v6a4 4 0 0 0 8 0V3", "M10 13v2a5 5 0 0 0 10 0v-2", "M20 11a2 2 0 1 0 0 .01"],
  oido: ["M7 10a5 5 0 1 1 10 0c0 3-3 4-3 7a3 3 0 0 1-6 0", "M10 10a2 2 0 1 1 4 0c0 1.5-1.5 2-1.5 3.5"],
  dolor: ["M13 2L5 14h6l-1 8 8-12h-6z"],
  corazon: ["M12 20s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.3 4.3 4.3 0 0 1 19.5 10C19.5 15.4 12 20 12 20z", "M7 12h3l1.5-2 2 4 1.5-2h2"],
  rinon: ["M9 4C5.5 4 4 7 4 11s1.5 9 5 9c2.5 0 3-2 2-4-.8-1.6-.8-3.4 0-5 1-2 .5-7-2-7z", "M15 4c3.5 0 5 3 5 7s-1.5 9-5 9"],
  cerebro: ["M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1z", "M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1"],
  estomago: ["M9 3v4c0 2-3 3-3 7a6 6 0 0 0 6 6h1a6 6 0 0 0 6-6c0-3-2-4-4-4s-3 1-3 3", "M9 7c2 0 3 1 3 3"],
  pie: ["M8 21c-2 0-3-1.5-3-3.5S7 13 7 10s1-6 4-6 3 3 3 5-1 3 0 5 3 2 3 4-2 3-4 3z", "M16 5h.01", "M18 7h.01", "M19.5 9.5h.01"],
  mente: ["M12 21v-4", "M8 17h8", "M12 3a6 6 0 0 0-6 6c0 2.5 1.5 4 3 5v3h6v-3c1.5-1 3-2.5 3-5a6 6 0 0 0-6-6z", "M10 9.5a2 2 0 0 1 4 0c0 1.5-2 1.5-2 3"],
  imagen: ["M4 5h16v14H4z", "M8 16l3-4 2 2.5 2-2.5 3 4", "M9 9.5h.01"],
  celula: ["M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 14.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5z", "M7 8h.01", "M17 16h.01", "M16 7h.01"],
  ambulancia: ["M3 16V8h11v8", "M14 11h4l3 3v2h-7", "M7 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M17 19a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M8.5 9.5v4", "M6.5 11.5h4"],
  diente: ["M7 3c-2.5 0-4 2-4 4.5 0 3 1.5 4.5 2 7 .5 3 1 6.5 3 6.5 1.5 0 1.5-3 2-5 .3-1.2 1.7-1.2 2 0 .5 2 .5 5 2 5 2 0 2.5-3.5 3-6.5.5-2.5 2-4 2-7C21 5 19.5 3 17 3c-2 0-3 1-5 1S9 3 7 3z"],
  hospital: ["M4 21V6l8-3 8 3v15", "M2 21h20", "M12 8v6", "M9 11h6", "M10 21v-3h4v3"],
  edificio: ["M5 21V4h9v17", "M14 9h5v12", "M8 8h3", "M8 12h3", "M8 16h3", "M3 21h18"],
  red: ["M12 7a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M5 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M19 21a2 2 0 1 0 0-4 2 2 0 0 0 0 4z", "M12 7v5", "M12 12l-6 5", "M12 12l6 5"],
  whatsapp: ["M4 20l1.3-4A8 8 0 1 1 8 18.7z", "M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.5-2-1-1 .8a4 4 0 0 1-1.8-1.8l.8-1-1-2z"],
  telefono: ["M5 4h3.5l1.5 4-2 1.5a10 10 0 0 0 6.5 6.5L16 14l4 1.5V19a1.5 1.5 0 0 1-1.5 1.5A15.5 15.5 0 0 1 3.5 5.5 1.5 1.5 0 0 1 5 4z"],
  chat: ["M4 5h16v11H9l-5 4z", "M8 9.5h8", "M8 12.5h5"],
  web: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M3 12h18", "M12 3c2.5 2.5 3.5 5.5 3.5 9s-1 6.5-3.5 9c-2.5-2.5-3.5-5.5-3.5-9s1-6.5 3.5-9z"],
  escudo: ["M12 3l8 3.5V12c0 4.4-3.4 8.1-8 9-4.6-.9-8-4.6-8-9V6.5z", "M9 12l2 2 4-4"],
  memoria: ["M12 3a7 7 0 0 0-7 7c0 2.5 1 4 2.5 5.3V20h9v-4.7C18 14 19 12.5 19 10a7 7 0 0 0-7-7z", "M9.5 10h5", "M12 7.5v5"],
  rayo: ["M13 2L4 14h7l-1 8 9-12h-7z"],
  grafico: ["M4 20V10", "M10 20V4", "M16 20v-7", "M22 20H2"],
  reloj: ["M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z", "M12 7v5l3 2"],
  lista: ["M8 6h12", "M8 12h12", "M8 18h12", "M4 6h.01", "M4 12h.01", "M4 18h.01"],
};

export function Icono({ nombre, className = "h-6 w-6" }: { nombre: IconoClave; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {TRAZOS[nombre].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

export function Flecha({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

export function Chevron({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M4 6l4 4 4-4" />
    </svg>
  );
}
