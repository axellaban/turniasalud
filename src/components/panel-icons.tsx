// Íconos de línea del panel (24×24, trazo 1,7). Se pintan con currentColor.
const PATHS = {
  inicio: ["M4 11.5 12 5l8 6.5", "M6 10v9h12v-9", "M10 19v-5h4v5"],
  agenda: ["M4 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z", "M4 10h16", "M8 3v4", "M16 3v4"],
  conversaciones: ["M5 5h14a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-7l-4 3v-3H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1z", "M8 9.5h8", "M8 12.5h5"],
  tareas: ["M9 6h11", "M9 12h11", "M9 18h11", "M4 6l1 1 2-2", "M4 12l1 1 2-2", "M4 18l1 1 2-2"],
  pacientes: ["M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M4.5 20a7.5 7.5 0 0 1 15 0"],
  campanas: ["M4 10v4h3l7 4V6l-7 4z", "M17 9a4 4 0 0 1 0 6", "M7 14l1 5h2.5"],
  configuracion: ["M4 6h9", "M17 6h3", "M15 4v4", "M4 12h3", "M11 12h9", "M9 10v4", "M4 18h11", "M19 18h1", "M17 16v4"],
  clinicas: ["M4 20V8l8-4 8 4v12", "M9 20v-5h6v5", "M12 8v4", "M10 10h4"],
  demos: ["M4 6h16v12H4z", "M4 7l8 6 8-6"],
  sistema: ["M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z", "M19 12a7 7 0 0 0-.1-1.2l2-1.5-2-3.4-2.3 1a7 7 0 0 0-2-1.2L14.3 3h-4l-.4 2.7a7 7 0 0 0-2 1.2l-2.3-1-2 3.4 2 1.5a7 7 0 0 0 0 2.4l-2 1.5 2 3.4 2.3-1a7 7 0 0 0 2 1.2l.4 2.7h4l.4-2.7a7 7 0 0 0 2-1.2l2.3 1 2-3.4-2-1.5c.1-.4.1-.8.1-1.2z"],
  mas: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
  salir: ["M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3", "M10 16l-4-4 4-4", "M6 12h10"],
  cerrar: ["M6 6l12 12", "M18 6L6 18"],
  mas_item: ["M12 5v14", "M5 12h14"],
  check: ["M5 12.5l4.5 4.5L19 7.5"],
  alerta: ["M12 4l9 16H3z", "M12 10v4", "M12 17h.01"],
  externo: ["M14 4h6v6", "M20 4l-9 9", "M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"],
  basura: ["M4 7h16", "M9 7V4h6v3", "M6 7l1 13h10l1-13"],
  editar: ["M4 20h4L19 9l-4-4L4 16z", "M13 7l4 4"],
  izquierda: ["M15 6l-6 6 6 6"],
  derecha: ["M9 6l6 6-6 6"],
  llave: ["M14.5 9.5a4.5 4.5 0 1 0-1.3 3.2L20 19.5V16h-2v-2h-2.2"],
  chat: ["M5 5h14v10H9l-4 4z"],
  prospeccion: ["M12 20a8 8 0 1 0 0-16 8 8 0 0 0 0 16z", "M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z", "M12 12h.01"],
} as const;

export type PanelIconName = keyof typeof PATHS;

export function PanelIcon({ name, className = "h-5 w-5" }: { name: PanelIconName; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      {PATHS[name].map((d) => <path key={d} d={d} />)}
    </svg>
  );
}
