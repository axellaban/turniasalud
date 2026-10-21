"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/panel", label: "Inicio", icon: "🏠" },
  { href: "/panel/agenda", label: "Agenda", icon: "📅" },
  { href: "/panel/conversaciones", label: "Conversaciones", icon: "💬" },
  { href: "/panel/tareas", label: "Tareas", icon: "✅" },
  { href: "/panel/pacientes", label: "Pacientes", icon: "👤" },
  { href: "/panel/campanas", label: "Campañas", icon: "📣" },
  { href: "/panel/demos", label: "Pedidos de demo", icon: "📩" },
  { href: "/panel/configuracion", label: "Configuración", icon: "⚙️" },
];

export function PanelNav() {
  const pathname = usePathname();
  return (
    <nav className="flex gap-1 overflow-x-auto px-3 pb-3 md:flex-col md:px-3">
      {ITEMS.map((item) => {
        const active = item.href === "/panel" ? pathname === "/panel" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-sm transition ${
              active ? "bg-white/10 font-semibold text-white" : "text-brand-100/80 hover:bg-white/5 hover:text-white"
            }`}
          >
            <span aria-hidden>{item.icon}</span>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
