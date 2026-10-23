"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { PanelIcon, type PanelIconName } from "@/components/panel-icons";

type Item = { href: string; label: string; short?: string; icon: PanelIconName };

const CLINIC: Item[] = [
  { href: "/panel", label: "Inicio", icon: "inicio" },
  { href: "/panel/agenda", label: "Agenda", icon: "agenda" },
  { href: "/panel/conversaciones", label: "Conversaciones", short: "Chats", icon: "conversaciones" },
  { href: "/panel/tareas", label: "Tareas", icon: "tareas" },
  { href: "/panel/pacientes", label: "Pacientes", icon: "pacientes" },
  { href: "/panel/campanas", label: "Campañas", icon: "campanas" },
  { href: "/panel/configuracion", label: "Configuración", icon: "configuracion" },
];

const ADMIN: Item[] = [
  { href: "/panel/clinicas", label: "Clínicas", icon: "clinicas" },
  { href: "/panel/demos", label: "Pedidos de demo", icon: "demos" },
  { href: "/panel/sistema", label: "Sistema", icon: "sistema" },
];

/** En el celular, la barra inferior muestra estas; el resto va en «Más». */
const PRIMARY = ["/panel", "/panel/agenda", "/panel/conversaciones", "/panel/tareas"];

const isActive = (pathname: string, href: string) => (href === "/panel" ? pathname === "/panel" : pathname === href || pathname.startsWith(`${href}/`));

function LogoutButton({ className }: { className: string }) {
  return (
    <form method="post" action="/api/panel/logout" onSubmit={() => {
      // Los borradores de la ficha quedan en este navegador: al salir se borran.
      try { for (const key of Object.keys(localStorage)) if (key.startsWith("turnia-borrador:")) localStorage.removeItem(key); } catch { /* sin almacenamiento */ }
    }}>
      <button className={className}>
        <PanelIcon name="salir" />
        Cerrar sesión
      </button>
    </form>
  );
}

export function PanelSidebarNav({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const section = (title: string, items: Item[]) => (
    <div>
      <p className="px-3 pb-1 pt-4 text-[11px] font-semibold uppercase tracking-wider text-brand-200/50">{title}</p>
      {items.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={`flex items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${
              active ? "bg-white/10 font-semibold text-white" : "text-brand-100/75 hover:bg-white/5 hover:text-white"
            }`}
          >
            <PanelIcon name={item.icon} className="h-[18px] w-[18px]" />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
  return (
    <nav aria-label="Panel" className="flex flex-1 flex-col px-3">
      {section("Consultorio", CLINIC)}
      {admin && section("Turnia", ADMIN)}
      <div className="mt-auto py-4">
        <LogoutButton className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm text-brand-100/75 hover:bg-white/5 hover:text-white" />
      </div>
    </nav>
  );
}

export function PanelMobileNav({ admin }: { admin: boolean }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const close = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);
  const all = [...CLINIC, ...(admin ? ADMIN : [])];
  const primary = all.filter((item) => PRIMARY.includes(item.href));
  const rest = all.filter((item) => !PRIMARY.includes(item.href));
  const restActive = rest.some((item) => isActive(pathname, item.href));
  const tab = "flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[11px] font-medium";
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Más secciones">
          <button aria-label="Cerrar" className="absolute inset-0 bg-brand-950/40" onClick={() => setOpen(false)} />
          <div className="absolute inset-x-0 bottom-0 rounded-t-3xl bg-white p-4 pb-[calc(1rem+env(safe-area-inset-bottom))] shadow-2xl">
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="text-sm font-semibold text-brand-950">Más secciones</p>
              <button onClick={() => setOpen(false)} aria-label="Cerrar" className="rounded-full p-2 text-brand-900/60 hover:bg-brand-50">
                <PanelIcon name="cerrar" />
              </button>
            </div>
            <div className="grid grid-cols-3 gap-2">
              {rest.map((item) => {
                const active = isActive(pathname, item.href);
                return (
                  <Link key={item.href} href={item.href} onClick={() => setOpen(false)} className={`flex flex-col items-center gap-1.5 rounded-2xl px-2 py-3 text-center text-xs font-medium ${active ? "bg-brand-50 text-brand-700" : "text-brand-900/80 hover:bg-brand-50"}`}>
                    <PanelIcon name={item.icon} className="h-6 w-6" />
                    {item.label}
                  </Link>
                );
              })}
            </div>
            <div className="mt-3 border-t border-brand-900/10 pt-2">
              <LogoutButton className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm text-brand-900/70 hover:bg-brand-50" />
            </div>
          </div>
        </div>
      )}
      <nav aria-label="Panel" className="fixed inset-x-0 bottom-0 z-30 flex border-t border-brand-900/10 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        {primary.map((item) => {
          const active = isActive(pathname, item.href);
          return (
            <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined} className={`${tab} ${active ? "text-brand-600" : "text-brand-900/55"}`}>
              <PanelIcon name={item.icon} className="h-6 w-6" />
              {item.short ?? item.label}
            </Link>
          );
        })}
        <button onClick={() => setOpen(true)} aria-expanded={open} className={`${tab} ${restActive ? "text-brand-600" : "text-brand-900/55"}`}>
          <PanelIcon name="mas" className="h-6 w-6" />
          Más
        </button>
      </nav>
    </>
  );
}
