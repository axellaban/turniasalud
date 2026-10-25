import Link from "next/link";
import type { ReactNode } from "react";
import { assignLanes, type Span } from "@/lib/agenda-layout";

// Grilla de la Agenda al estilo de un calendario: una columna por día (semana) o por
// profesional (día), las horas hacia abajo y cada turno ubicado en su horario.

const HOUR_PX = 56;
const SLOT_MIN = 30;

export const PRO_COLORS = [
  { block: "bg-brand-100 border-brand-500 text-brand-950", dot: "bg-brand-500" },
  { block: "bg-teal-100 border-teal-600 text-teal-950", dot: "bg-teal-600" },
  { block: "bg-amber-100 border-amber-500 text-amber-950", dot: "bg-amber-500" },
  { block: "bg-violet-100 border-violet-500 text-violet-950", dot: "bg-violet-500" },
  { block: "bg-rose-100 border-rose-500 text-rose-950", dot: "bg-rose-500" },
  { block: "bg-sky-100 border-sky-600 text-sky-950", dot: "bg-sky-600" },
];

export type GridEvent = Span & {
  id: string;
  column: number;
  time: string;
  title: string;
  detail: string;
  status: string;
  color: number;
  href: string;
  selected: boolean;
  /** Ya terminó y nadie lo marcó como atendido o ausente. */
  unmarked?: boolean;
};

export type GridColumn = {
  key: string;
  heading: ReactNode;
  /** Horario de atención, en minutos del día. */
  open: Span[];
  /** Feriados y bloqueos, con su motivo. */
  blocks: Array<Span & { label: string }>;
  /** Ocupado en Google Calendar. */
  google: Span[];
  /** Minuto actual si la columna es de hoy. */
  now: number | null;
  /** Desde qué minuto se puede agregar un turno (null: nada, el día ya pasó). */
  bookableFrom: number | null;
  slotHref: (minute: number) => string;
  slotLabel: (time: string) => string;
};

export const clock = (minute: number) => `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;

const px = (minutes: number) => (minutes / 60) * HOUR_PX;

const STATUS_STYLE: Record<string, string> = {
  confirmado: "",
  pendiente: "border-dashed !bg-white",
  atendido: "opacity-60",
  ausente: "!bg-red-50 !border-red-400 !text-red-800",
};

export function CalendarGrid({ columns, events, hours, minWidth }: { columns: GridColumn[]; events: GridEvent[]; hours: Span; minWidth?: number }) {
  const height = px(hours.end - hours.start);
  const hourMarks = Array.from({ length: (hours.end - hours.start) / 60 + 1 }, (_, i) => hours.start + i * 60);
  const top = (minute: number) => px(Math.max(hours.start, Math.min(hours.end, minute)) - hours.start);
  const clip = (s: Span) => ({ start: Math.max(s.start, hours.start), end: Math.min(s.end, hours.end) });
  const template = `52px repeat(${columns.length}, minmax(0, 1fr))`;

  return (
    <div className="max-h-[calc(100dvh-14rem)] min-h-[26rem] overflow-auto rounded-2xl bg-white ring-1 ring-brand-900/10">
      <div style={{ minWidth }}>
        <div className="sticky top-0 z-30 grid border-b border-brand-900/10 bg-white/95 backdrop-blur" style={{ gridTemplateColumns: template }}>
          <span className="flex items-end justify-center pb-2 text-[10px] text-brand-900/45">GMT-3</span>
          {columns.map((c) => (
            <div key={c.key} className="min-w-0 border-l border-brand-900/5 px-1 py-2">{c.heading}</div>
          ))}
        </div>

        <div className="relative grid" style={{ gridTemplateColumns: template, height }}>
          {/* Horas */}
          <div className="relative">
            {hourMarks.slice(0, -1).map((m) => (
              <span key={m} className="absolute right-2 -translate-y-1/2 text-[11px] tabular-nums text-brand-900/50" style={{ top: top(m) }}>
                {m === hours.start ? "" : clock(m)}
              </span>
            ))}
          </div>

          {columns.map((c, ci) => (
            <div key={c.key} className="relative border-l border-brand-900/5 bg-brand-900/[0.035]">
              {/* Horario de atención en blanco; el resto queda gris. */}
              {c.open.map((s) => {
                const v = clip(s);
                return v.end > v.start ? <div key={`o${s.start}`} className="absolute inset-x-0 bg-white" style={{ top: top(v.start), height: px(v.end - v.start) }} /> : null;
              })}
              {hourMarks.map((m) => (
                <div key={m} className="pointer-events-none absolute inset-x-0 border-t border-brand-900/[0.07]" style={{ top: top(m) }} />
              ))}

              {/* Huecos para agregar un turno a mano. */}
              {c.bookableFrom !== null && c.open.flatMap((s) => {
                const out = [];
                for (let m = Math.ceil(s.start / SLOT_MIN) * SLOT_MIN; m + SLOT_MIN <= s.end; m += SLOT_MIN) {
                  if (m < c.bookableFrom! || m < hours.start || m >= hours.end) continue;
                  out.push(
                    <Link
                      key={`s${m}`}
                      href={c.slotHref(m)}
                      scroll={false}
                      tabIndex={-1}
                      aria-label={c.slotLabel(clock(m))}
                      className="group absolute inset-x-0.5 z-0 flex items-start rounded-md px-1.5 pt-0.5 text-[11px] font-medium text-transparent hover:bg-brand-50 hover:text-brand-700"
                      style={{ top: top(m), height: px(SLOT_MIN) }}
                    >
                      + {clock(m)}
                    </Link>,
                  );
                }
                return out;
              })}

              {c.blocks.map((b) => {
                const v = clip(b);
                if (v.end <= v.start) return null;
                return (
                  <div key={`b${b.start}`} className="pointer-events-none absolute inset-x-0 z-[5] overflow-hidden bg-[repeating-linear-gradient(135deg,rgba(255,201,122,0.35)_0_6px,rgba(255,241,220,0.6)_6px_12px)] px-1.5 py-1 text-[11px] font-medium text-amber-900" style={{ top: top(v.start), height: px(v.end - v.start) }}>
                    {b.label}
                  </div>
                );
              })}
              {c.google.map((g, gi) => {
                const v = clip(g);
                if (v.end <= v.start) return null;
                return (
                  <div key={`g${gi}`} title="Ocupado en Google Calendar" className="pointer-events-none absolute inset-x-1 z-[6] overflow-hidden rounded-md bg-[repeating-linear-gradient(135deg,rgba(8,24,63,0.06)_0_5px,rgba(8,24,63,0.02)_5px_10px)] px-1.5 py-0.5 text-[10px] text-brand-900/60 ring-1 ring-brand-900/10" style={{ top: top(v.start), height: px(v.end - v.start) }}>
                    {px(v.end - v.start) >= 18 && "Ocupado en Google"}
                  </div>
                );
              })}

              {assignLanes(events.filter((e) => e.column === ci)).map((e) => {
                const h = Math.max(px(e.end - e.start) - 2, 16);
                const compact = h < 34;
                return (
                  <Link
                    key={e.id}
                    href={e.href}
                    scroll={false}
                    aria-current={e.selected ? "true" : undefined}
                    title={`${e.time} · ${e.title} · ${e.detail}`}
                    className={`absolute z-10 overflow-hidden rounded-md border-l-[3px] px-1.5 leading-tight shadow-sm ring-1 ring-black/5 transition hover:z-20 hover:shadow-md ${PRO_COLORS[e.color % PRO_COLORS.length].block} ${STATUS_STYLE[e.status] ?? ""} ${e.selected ? "z-20 ring-2 ring-brand-600" : e.unmarked ? "ring-1 ring-amber-400" : ""}`}
                    style={{
                      top: top(e.start) + 1,
                      height: h,
                      left: `calc(${(e.lane / e.lanes) * 100}% + 2px)`,
                      width: `calc(${100 / e.lanes}% - 4px)`,
                    }}
                  >
                    {compact ? (
                      <span className="block truncate pt-px text-[11px]">
                        <strong className={`font-semibold ${e.status === "ausente" ? "line-through" : ""}`}>{e.status === "atendido" ? "✓ " : ""}{e.title}</strong>{" "}
                        <span className="tabular-nums opacity-75">{e.time.split("–")[0]}</span>
                      </span>
                    ) : (
                      <span className="block pt-1 text-[11px]">
                        <strong className={`block truncate text-[12px] font-semibold ${e.status === "ausente" ? "line-through" : ""}`}>
                          {e.status === "atendido" ? "✓ " : ""}{e.title}
                        </strong>
                        <span className="block truncate tabular-nums opacity-75">{e.time}</span>
                        {h >= 52 && <span className="block truncate opacity-75">{e.detail}</span>}
                      </span>
                    )}
                  </Link>
                );
              })}

              {c.now !== null && c.now >= hours.start && c.now <= hours.end && (
                <div className="pointer-events-none absolute inset-x-0 z-[25] border-t-2 border-red-500" style={{ top: top(c.now) }}>
                  <span className="absolute -left-1.5 -top-[7px] h-3 w-3 rounded-full bg-red-500" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/** Encabezado de una columna: el día (o profesional), cuántos turnos y qué tan lleno está. */
export function ColumnHeading({ top, main, highlight, count, ratio, blocked, href, current }: {
  top: ReactNode;
  main: ReactNode;
  highlight?: boolean;
  count: number;
  ratio: number | null;
  /** Atiende ese día, pero está todo bloqueado (feriado, vacaciones). */
  blocked?: boolean;
  href?: string;
  current?: boolean;
}) {
  const body = (
    <>
      <span className="block truncate text-[11px] font-medium uppercase text-brand-900/60">{top}</span>
      <span className={`mx-auto mt-0.5 grid h-8 min-w-8 place-items-center rounded-full px-1 text-lg font-semibold leading-none ${highlight ? "bg-brand-600 text-white" : "text-brand-950"}`}>{main}</span>
      {ratio === null ? (
        <span className="mt-1.5 block text-[11px] text-brand-900/40">{count ? `${count} turno${count === 1 ? "" : "s"}` : blocked ? "Bloqueado" : "No atiende"}</span>
      ) : (
        <>
          <span className="mx-auto mt-1.5 block h-1 w-full max-w-24 overflow-hidden rounded-full bg-brand-900/10" title={`${Math.round(ratio * 100)}% de la agenda ocupada`}>
            <span className={`block h-full rounded-full ${ratio >= 0.85 ? "bg-red-500" : ratio >= 0.5 ? "bg-amber-500" : "bg-brand-500"}`} style={{ width: `${Math.max(ratio * 100, ratio ? 6 : 0)}%` }} />
          </span>
          <span className="mt-1 block text-[11px] tabular-nums text-brand-900/60">
            {count ? `${count} turno${count === 1 ? "" : "s"} · ` : ""}{Math.round(ratio * 100)}%
          </span>
        </>
      )}
    </>
  );
  const cls = `block rounded-xl px-1 py-0.5 text-center ${current ? "bg-brand-50" : ""}`;
  return href ? <Link href={href} scroll={false} className={`${cls} hover:bg-brand-50`}>{body}</Link> : <div className={cls}>{body}</div>;
}
