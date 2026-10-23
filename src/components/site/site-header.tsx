"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Logo } from "@/components/logo";
import {
  EMPRESA,
  PLATAFORMA,
  RECURSOS,
  SOLUCIONES_CASOS,
  SOLUCIONES_ESPECIALIDADES,
  SOLUCIONES_ORGANIZACIONES,
  type EnlaceMenu,
} from "@/content/site";
import { Chevron, Flecha, Icono } from "./iconos";

type MenuId = "plataforma" | "soluciones" | "recursos" | "empresa";

const MENUS: { id: MenuId; nombre: string }[] = [
  { id: "plataforma", nombre: "Plataforma" },
  { id: "soluciones", nombre: "Soluciones" },
  { id: "recursos", nombre: "Recursos" },
  { id: "empresa", nombre: "Empresa" },
];

function ItemDestacado({ e }: { e: EnlaceMenu }) {
  return (
    <Link href={e.href} className="group flex items-start gap-3 rounded-xl p-3 hover:bg-brand-50">
      {e.icono && (
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-brand-50 text-brand-600 group-hover:bg-white">
          <Icono nombre={e.icono} className="h-5 w-5" />
        </span>
      )}
      <span>
        <span className="block text-sm font-semibold text-brand-950">{e.nombre}</span>
        {e.detalle && <span className="mt-0.5 block text-xs leading-snug text-tinta">{e.detalle}</span>}
      </span>
    </Link>
  );
}

function Columna({ titulo, items, columnas = 1 }: { titulo: string; items: EnlaceMenu[]; columnas?: 1 | 2 }) {
  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-tinta/70">{titulo}</p>
      <ul className={columnas === 2 ? "grid grid-cols-2 gap-x-6" : ""}>
        {items.map((e) => (
          <li key={e.href}>
            <Link href={e.href} className="block rounded-md py-1.5 text-sm text-brand-950/85 hover:text-brand-600">
              {e.nombre}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PanelMenu({ id }: { id: MenuId }) {
  if (id === "plataforma")
    return (
      <div className="grid w-[640px] grid-cols-[1fr_220px] gap-4">
        <div className="grid gap-1">
          {PLATAFORMA.map((e) => (
            <ItemDestacado key={e.href} e={e} />
          ))}
        </div>
        <Link href="/escucha-a-nuestros-agentes" className="flex flex-col justify-between rounded-2xl bg-gradient-to-br from-brand-600 to-brand-800 p-5 text-white">
          <span className="text-sm font-semibold leading-snug">Escuchá cómo atiende Turnia en cada especialidad</span>
          <span className="mt-6 inline-flex items-center gap-1 text-xs font-medium text-brand-100">
            Escuchar demos <Flecha className="h-3.5 w-3.5" />
          </span>
        </Link>
      </div>
    );
  if (id === "soluciones")
    return (
      <div className="grid w-[880px] grid-cols-[1fr_1.5fr_1fr] gap-8">
        <Columna titulo="Por caso de uso" items={SOLUCIONES_CASOS} />
        <Columna titulo="Por especialidad" items={SOLUCIONES_ESPECIALIDADES} columnas={2} />
        <Columna titulo="Por tipo de organización" items={SOLUCIONES_ORGANIZACIONES} />
      </div>
    );
  if (id === "recursos")
    return (
      <div className="grid w-[420px] gap-1">
        {RECURSOS.map((e) => (
          <ItemDestacado key={e.href} e={e} />
        ))}
      </div>
    );
  return (
    <div className="w-[240px]">
      <Columna titulo="Empresa" items={EMPRESA} />
    </div>
  );
}

export function SiteHeader() {
  const [abierto, setAbierto] = useState<MenuId | null>(null);
  const [movil, setMovil] = useState(false);
  const [seccionMovil, setSeccionMovil] = useState<MenuId | null>(null);
  const pathname = usePathname();
  const cierre = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Cerrar todo al navegar (ajuste de estado durante el render, sin efecto).
  const [ruta, setRuta] = useState(pathname);
  if (ruta !== pathname) {
    setRuta(pathname);
    setAbierto(null);
    setMovil(false);
  }

  // En la home, arriba de todo y en el celular, la barra es transparente sobre el video (como Assort).
  const [arriba, setArriba] = useState(true);
  useEffect(() => {
    const onScroll = () => setArriba(window.scrollY < 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  const sobreVideo = pathname === "/" && arriba && !movil;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && (setAbierto(null), setMovil(false));
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const abrir = (id: MenuId) => {
    if (cierre.current) clearTimeout(cierre.current);
    setAbierto(id);
  };
  const cerrarLuego = () => {
    cierre.current = setTimeout(() => setAbierto(null), 140);
  };

  const listaMovil: Record<MenuId, { titulo: string; items: EnlaceMenu[] }[]> = {
    plataforma: [{ titulo: "Plataforma", items: PLATAFORMA }],
    soluciones: [
      { titulo: "Por caso de uso", items: SOLUCIONES_CASOS },
      { titulo: "Por especialidad", items: SOLUCIONES_ESPECIALIDADES },
      { titulo: "Por tipo de organización", items: SOLUCIONES_ORGANIZACIONES },
    ],
    recursos: [{ titulo: "Recursos", items: RECURSOS }],
    empresa: [{ titulo: "Empresa", items: EMPRESA }],
  };

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-6">
      <nav
        className={`relative mx-auto flex max-w-[1240px] items-center justify-between gap-4 rounded-xl bg-white/95 px-4 py-2.5 shadow-[0_8px_30px_rgb(8_24_63/0.08)] ring-1 ring-brand-950/5 backdrop-blur transition-[background-color,box-shadow] duration-300 ${
          sobreVideo ? "max-lg:bg-transparent max-lg:shadow-none max-lg:ring-0 max-lg:backdrop-blur-none" : ""
        }`}
        aria-label="Principal"
      >
        <Link href="/" aria-label="Turnia Salud, inicio" className="shrink-0">
          <span className="lg:hidden"><Logo light={sobreVideo} /></span>
          <span className="hidden lg:inline"><Logo /></span>
        </Link>

        <ul className="hidden items-center gap-1 lg:flex">
          {MENUS.map((m) => (
            <li key={m.id} className="relative" onMouseEnter={() => abrir(m.id)} onMouseLeave={cerrarLuego}>
              <button
                type="button"
                aria-expanded={abierto === m.id}
                aria-haspopup="true"
                onClick={() => setAbierto(abierto === m.id ? null : m.id)}
                className={`inline-flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[15px] transition ${
                  abierto === m.id ? "bg-brand-50 text-brand-700" : "text-brand-950/85 hover:text-brand-700"
                }`}
              >
                {m.nombre}
                <Chevron className={`h-3.5 w-3.5 transition ${abierto === m.id ? "rotate-180" : ""}`} />
              </button>
            </li>
          ))}
          <li>
            <Link href="/escucha-a-nuestros-agentes" className="rounded-lg px-3.5 py-2 text-[15px] text-brand-950/85 hover:text-brand-700">
              Escuchá
            </Link>
          </li>
        </ul>

        <div className="flex items-center gap-2">
          <Link href="/probar-demo" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-brand-700 hover:text-brand-900 md:inline-block">
            Probá con tu web
          </Link>
          <Link href="/panel" className="hidden rounded-lg px-3 py-2 text-sm font-medium text-brand-950/80 hover:text-brand-700 sm:inline-block">
            Ingresar
          </Link>
          <Link href="/pedi-una-demo" className={`rounded-lg bg-brand-600 px-4 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-brand-700 ${sobreVideo ? "max-lg:hidden" : ""}`}>
            Pedí una demo
          </Link>
          <button
            type="button"
            className={`grid h-10 w-10 place-items-center rounded-lg lg:hidden ${sobreVideo ? "text-white hover:bg-white/10" : "text-brand-950 hover:bg-brand-50"}`}
            aria-label={movil ? "Cerrar menú" : "Abrir menú"}
            aria-expanded={movil}
            onClick={() => setMovil(!movil)}
          >
            <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" aria-hidden="true">
              {movil ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>

        {abierto && (
          <div
            className="absolute left-1/2 top-full z-50 hidden -translate-x-1/2 pt-3 lg:block"
            onMouseEnter={() => abrir(abierto)}
            onMouseLeave={cerrarLuego}
          >
            <div className="animar-aparecer rounded-2xl bg-white p-6 shadow-[0_24px_60px_rgb(8_24_63/0.16)] ring-1 ring-brand-950/5" style={{ animationDuration: "0.2s" }}>
              <PanelMenu id={abierto} />
            </div>
          </div>
        )}
      </nav>

      {movil && (
        <div className="mx-auto mt-2 max-h-[calc(100vh-6rem)] max-w-[1240px] overflow-y-auto rounded-xl bg-white p-4 shadow-xl ring-1 ring-brand-950/5 lg:hidden">
          <ul className="divide-y divide-brand-950/5">
            {MENUS.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="flex w-full items-center justify-between py-3 text-left font-medium text-brand-950"
                  aria-expanded={seccionMovil === m.id}
                  onClick={() => setSeccionMovil(seccionMovil === m.id ? null : m.id)}
                >
                  {m.nombre}
                  <Chevron className={`h-4 w-4 transition ${seccionMovil === m.id ? "rotate-180" : ""}`} />
                </button>
                {seccionMovil === m.id && (
                  <div className="space-y-4 pb-4">
                    {listaMovil[m.id].map((g) => (
                      <div key={g.titulo}>
                        <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-tinta/70">{g.titulo}</p>
                        <ul className="grid grid-cols-2 gap-x-4">
                          {g.items.map((e) => (
                            <li key={e.href}>
                              <Link href={e.href} className="block py-1.5 text-sm text-brand-950/80">
                                {e.nombre}
                              </Link>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </li>
            ))}
            <li>
              <Link href="/escucha-a-nuestros-agentes" className="block py-3 font-medium text-brand-950">
                Escuchá a nuestros agentes
              </Link>
            </li>
            <li>
              <Link href="/probar-demo" className="block py-3 font-medium text-brand-700">
                Probá la demo con tu web
              </Link>
            </li>
            <li>
              <Link href="/pedi-una-demo" className="block py-3 font-medium text-brand-950">
                Pedí una demo
              </Link>
            </li>
            <li>
              <Link href="/panel" className="block py-3 font-medium text-brand-950">
                Ingresar al panel
              </Link>
            </li>
          </ul>
        </div>
      )}
    </header>
  );
}
