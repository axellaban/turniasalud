import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="font-display text-2xl tracking-tight text-brand-950 sm:text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-brand-900/60">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  // p-0 en className: listas que llegan hasta el borde de la tarjeta.
  return <div className={`rounded-2xl border border-brand-900/10 bg-white ${/\bp-0\b/.test(className) ? "" : "p-5"} ${className}`}>{children}</div>;
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: string }) {
  return (
    <Card>
      <p className="text-xs font-medium uppercase tracking-wider text-brand-900/50">{label}</p>
      <p className="mt-2 font-display text-3xl text-brand-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-brand-900/50">{hint}</p>}
    </Card>
  );
}

const TONES = {
  gray: "bg-neutral-100 text-neutral-700",
  green: "bg-brand-50 text-brand-700 ring-1 ring-brand-200",
  yellow: "bg-sun-100 text-sun-600",
  red: "bg-red-50 text-red-700",
  blue: "bg-sky-50 text-sky-700",
} as const;

export function Badge({ children, tone = "gray" }: { children: ReactNode; tone?: keyof typeof TONES }) {
  return <span className={`inline-flex shrink-0 items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ${TONES[tone]}`}>{children}</span>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-2xl border border-dashed border-brand-900/15 p-8 text-center text-sm text-brand-900/50">{children}</p>;
}

export const buttonClass =
  "inline-flex items-center justify-center gap-1 rounded-full bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50";
export const secondaryButtonClass =
  "inline-flex items-center justify-center gap-1 rounded-full px-4 py-2 text-sm font-semibold text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50";
export const dangerButtonClass =
  "inline-flex items-center justify-center gap-1 rounded-full px-4 py-2 text-sm font-semibold text-red-700 ring-1 ring-red-200 hover:bg-red-50 disabled:opacity-50";
export const ghostButtonClass =
  "inline-flex items-center justify-center gap-1 rounded-full px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-50";
export const smallButtonClass =
  "rounded-full px-2.5 py-1 text-xs font-medium text-brand-800 ring-1 ring-brand-200 hover:bg-brand-50";
export const inputClass =
  "w-full rounded-xl border border-brand-900/15 bg-white px-3 py-2 text-sm outline-none focus:border-brand-500";

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="font-medium text-brand-900">{label}</span>
      <div className="mt-1">{children}</div>
      {hint && <span className="mt-1 block text-xs text-brand-900/50">{hint}</span>}
    </label>
  );
}

/** Pestañas de una sección (cada una es su propia ruta: se pueden compartir y recargar). */
export function Tabs({ items, current }: { items: Array<{ href: string; label: string; count?: number }>; current: string }) {
  return (
    <nav aria-label="Secciones" className="-mx-4 mb-6 overflow-x-auto border-b border-brand-900/10 px-4 sm:mx-0 sm:px-0">
      <ul className="flex min-w-max gap-1">
        {items.map((item) => {
          const active = item.href === current;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={`-mb-px inline-flex items-center gap-1.5 border-b-2 px-3 py-2.5 text-sm font-medium transition ${
                  active ? "border-brand-600 text-brand-700" : "border-transparent text-brand-900/60 hover:text-brand-900"
                }`}
              >
                {item.label}
                {item.count !== undefined && <span className="rounded-full bg-brand-50 px-1.5 text-xs text-brand-700">{item.count}</span>}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

const NOTICE = {
  info: "border-brand-200 bg-brand-50/70 text-brand-900",
  success: "border-emerald/40 bg-emerald/10 text-brand-950",
  warning: "border-sun-300 bg-sun-100/60 text-brand-950",
  error: "border-red-200 bg-red-50 text-red-800",
} as const;

/** Aviso en línea, con el mismo aspecto en todo el panel. */
export function Notice({ tone = "info", children, className = "" }: { tone?: keyof typeof NOTICE; children: ReactNode; className?: string }) {
  return <div role={tone === "error" ? "alert" : "status"} className={`rounded-xl border px-3 py-2 text-sm ${NOTICE[tone]} ${className}`}>{children}</div>;
}

export const CHANNEL_LABEL: Record<string, string> = {
  whatsapp: "💬 WhatsApp",
  telegram: "✈️ Telegram",
  telefono: "📞 Teléfono",
  web: "🌐 Web",
  panel: "🖥️ Panel",
  campana: "📣 Campaña",
};

export const STATUS_TONE: Record<string, keyof typeof TONES> = {
  confirmado: "green",
  pendiente: "yellow",
  cancelado: "red",
  reprogramado: "gray",
  ausente: "red",
  atendido: "blue",
  abierta: "yellow",
  en_curso: "blue",
  resuelta: "green",
  resuelto: "green",
  derivado: "yellow",
  sin_resolver: "red",
  urgente: "red",
  alta: "yellow",
  normal: "gray",
  baja: "gray",
  enviado: "blue",
  respondio: "yellow",
  agendo: "green",
  error: "red",
  borrador: "gray",
  enviando: "yellow",
  finalizada: "green",
};

export function StatusBadge({ value }: { value: string | null | undefined }) {
  if (!value) return null;
  return <Badge tone={STATUS_TONE[value] ?? "gray"}>{value.replace(/_/g, " ")}</Badge>;
}
