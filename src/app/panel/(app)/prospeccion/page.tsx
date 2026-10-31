import Link from "next/link";
import type { Metadata } from "next";
import { after } from "next/server";
import { requireAdmin } from "@/lib/panel-clinic";
import { ensureDemoPreviews } from "@/lib/sales/demo-preview";
import { Card, Empty, Notice, PageHeader, Stat, Tabs, buttonClass, ghostButtonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import {
  PAGE_SIZE,
  listOutreach,
  outreachDemoUrl,
  outreachQueue,
  outreachSettings,
  outreachStats,
  outreachZones,
  todayKey,
  type OutreachView,
} from "@/lib/sales/outreach";
import { OutreachRow } from "./outreach-row";

export const metadata: Metadata = { title: "Prospección · Panel" };

const VIEWS: OutreachView[] = ["hoy", "seguimientos", "interesados", "todos"];
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
const pct = (part: number, total: number) => (total ? `${Math.round((part / total) * 100)} %` : "—");

export default async function ProspeccionPage({ searchParams }: PageProps<"/panel/prospeccion">) {
  await requireAdmin();
  // Las vistas previas de WhatsApp que falten (los recién sumados, o todas si cambió el dibujo).
  after(() => ensureDemoPreviews());
  const params = await searchParams;
  const view = (VIEWS as string[]).includes(one(params.vista) ?? "") ? (one(params.vista) as OutreachView) : "hoy";
  const filter = { zone: one(params.zona) ?? null, q: one(params.q) ?? null, channel: one(params.canal) ?? null, status: one(params.estado) ?? null };
  const page = Math.max(1, Number(one(params.p)) || 1);
  const more = Number(one(params.mas)) || 0;
  const today = todayKey();

  const [settings, stats, zones] = await Promise.all([outreachSettings(), outreachStats(), outreachZones()]);
  const remaining = Math.max(0, settings.daily_goal - stats.today_new) + more;
  const queue = view === "hoy" ? await outreachQueue(filter, remaining) : null;
  const list = view === "hoy" ? null : await listOutreach({ view, ...filter, page });
  const query = (extra: Record<string, string | number | null | undefined>) => {
    const out = new URLSearchParams();
    for (const [k, v] of Object.entries({ vista: view === "hoy" ? null : view, zona: filter.zone, q: filter.q, canal: filter.channel, estado: filter.status, ...extra })) {
      if (v !== null && v !== undefined && v !== "") out.set(k, String(v));
    }
    const s = out.toString();
    return `/panel/prospeccion${s ? `?${s}` : ""}`;
  };
  const row = (p: Parameters<typeof OutreachRow>[0]["p"]) => <OutreachRow key={p.id} p={p} templates={settings.templates} link={outreachDemoUrl(p.code)} today={today} />;

  return (
    <>
      <PageHeader
        title="Prospección"
        description="Odontólogos de Mar del Plata y Miramar, cada uno con su demo armada. Escribile a la persona que decide, de a uno, desde tu WhatsApp."
        actions={
          <>
            <Link href="/panel/prospeccion/mensajes" className={secondaryButtonClass}>
              Mensajes y metas
            </Link>
            <Link href="/panel/prospeccion/importar" className={secondaryButtonClass}>
              Importar lista
            </Link>
            <Link href="/panel/prospeccion/planilla" className={secondaryButtonClass}>
              Google Sheets
            </Link>
          </>
        }
      />

      {stats.total === 0 ? (
        <Card>
          <h2 className="font-display text-xl text-brand-950">Todavía no hay a quién escribirle</h2>
          <p className="mt-2 max-w-2xl text-sm text-brand-900/75">
            Importá la lista de odontólogos (CSV o celdas de Excel). Cada persona queda con su link de demo, su mensaje armado y el seguimiento programado.
          </p>
          <Link href="/panel/prospeccion/importar" className={`${buttonClass} mt-4`}>
            Importar la lista
          </Link>
        </Card>
      ) : (
        <>
          <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Hoy" value={`${stats.today_new} / ${settings.daily_goal}`} hint={`nuevos · ${stats.today_followups} seguimientos`} />
            <Stat label="Esta semana" value={`${stats.week_new} / ${settings.weekly_goal}`} hint="primeros contactos desde el lunes" />
            <Stat label="Respondieron" value={stats.replied} hint={`${pct(stats.replied, stats.contacted)} de ${stats.contacted} contactados`} />
            <Stat label="Abrieron su demo" value={stats.opened} hint={`${stats.demos} la probaron · ${stats.meetings} reuniones`} />
          </div>

          <Tabs
            current={query({ p: null, mas: null })}
            items={[
              { href: query({ vista: null, p: null }), label: "Para hoy", count: stats.due_followups + Math.min(remaining, stats.pending) },
              { href: query({ vista: "seguimientos", p: null }), label: "Esperando respuesta" },
              { href: query({ vista: "interesados", p: null }), label: "Interesados", count: stats.interested },
              { href: query({ vista: "todos", p: null }), label: "Todos", count: stats.total },
            ]}
          />

          <form className="mb-5 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end" action="/panel/prospeccion">
            {view !== "hoy" && <input type="hidden" name="vista" value={view} />}
            <label className="text-sm">
              <span className="sr-only">Zona</span>
              <select name="zona" defaultValue={filter.zone ?? ""} className={`${inputClass} sm:w-auto`}>
                <option value="">Todas las zonas</option>
                {zones.map((z) => (
                  <option key={z.zone} value={z.zone}>
                    {z.zone} ({z.count})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="sr-only">Canal</span>
              <select name="canal" defaultValue={filter.channel ?? ""} className={`${inputClass} sm:w-auto`}>
                <option value="">Cualquier canal</option>
                <option value="celular">Celular</option>
                <option value="consultorio">Celular del consultorio</option>
                <option value="fijo">Teléfono fijo (no se cuentan)</option>
                <option value="instagram">Instagram</option>
                <option value="sin">Sin contacto</option>
              </select>
            </label>
            {view === "todos" && (
              <label className="col-span-2 text-sm">
                <span className="sr-only">Estado</span>
                <select name="estado" defaultValue={filter.status ?? ""} className={`${inputClass} sm:w-auto`}>
                  <option value="">Cualquier estado</option>
                  <option value="por_contactar">Por contactar</option>
                  <option value="contactado">Contactado</option>
                  <option value="respondio">Respondió</option>
                  <option value="reunion">Reunión</option>
                  <option value="cliente">Cliente</option>
                  <option value="no_interesa">No le interesa</option>
                  <option value="sin_canal">Sin WhatsApp</option>
                  <option value="baja">Pidió no recibir más</option>
                </select>
              </label>
            )}
            <div className="col-span-2 flex min-w-[12rem] flex-1 gap-2">
              <label className="min-w-0 flex-1 text-sm">
                <span className="sr-only">Buscar</span>
                <input type="search" name="q" defaultValue={filter.q ?? ""} placeholder="Nombre, consultorio, calle o especialidad" className={inputClass} />
              </label>
              <button className={secondaryButtonClass}>Filtrar</button>
              {(filter.zone || filter.q || filter.channel || filter.status) && (
                <Link href={view === "hoy" ? "/panel/prospeccion" : `/panel/prospeccion?vista=${view}`} className={ghostButtonClass}>
                  Limpiar
                </Link>
              )}
            </div>
          </form>

          {queue && (
            <div className="space-y-6">
              {queue.followups.length > 0 && (
                <Card>
                  <h2 className="font-display text-xl text-brand-950">Seguimientos de hoy</h2>
                  <p className="mt-1 text-sm text-brand-900/70">
                    A quienes saludaste y les falta la demo (mandásela cuando te respondan) y a quienes les escribiste hace unos días y no respondieron.
                    Primero, quienes abrieron o probaron su demo.
                  </p>
                  <ul className="mt-2 divide-y divide-brand-900/5">{queue.followups.map(row)}</ul>
                </Card>
              )}
              <Card>
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2 className="font-display text-xl text-brand-950">Nuevos para hoy</h2>
                  <p className="text-sm text-brand-900/70">
                    {stats.today_new} de {settings.daily_goal} · quedan {stats.pending} por contactar
                  </p>
                </div>
                <p className="mt-1 text-sm text-brand-900/70">
                  De a uno, con un minuto entre mensajes. Solo números con WhatsApp: primero los celulares propios y los que muestran que invierten en su consultorio.
                  Los fijos no entran ni cuentan.
                </p>
                {queue.fresh.length > 0 ? (
                  <ul className="mt-2 divide-y divide-brand-900/5">{queue.fresh.map(row)}</ul>
                ) : stats.pending === 0 ? (
                  <Empty>No queda nadie con celular por contactar con este filtro. Importá más odontólogos o cargale un celular a alguien desde «Todos».</Empty>
                ) : (
                  <div className="mt-4 rounded-xl bg-brand-50/70 p-4 text-sm text-brand-950">
                    <p className="font-semibold">Meta de hoy cumplida.</p>
                    <p className="mt-1 text-brand-900/75">Si querés seguir, sumá más. Mañana la cola arranca de nuevo.</p>
                    <Link href={query({ mas: more + 10 })} className={`${secondaryButtonClass} mt-3`}>
                      Diez más
                    </Link>
                  </div>
                )}
              </Card>
              {stats.due_followups === 0 && queue.followups.length === 0 && stats.contacted > 0 && (
                <Notice>No hay seguimientos para hoy. Los que esperan respuesta están en «Esperando respuesta».</Notice>
              )}
            </div>
          )}

          {list && (
            <Card className="p-0">
              {list.rows.length === 0 ? (
                <div className="p-5">
                  <Empty>{view === "interesados" ? "Todavía nadie respondió ni abrió su demo." : view === "seguimientos" ? "Nadie esperando respuesta." : "No hay nadie con este filtro."}</Empty>
                </div>
              ) : (
                <ul className="divide-y divide-brand-900/5 px-5">{list.rows.map(row)}</ul>
              )}
              {list.total > PAGE_SIZE && (
                <div className="flex items-center justify-between border-t border-brand-900/5 px-5 py-3 text-sm">
                  <span className="text-brand-900/65">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, list.total)} de {list.total}
                  </span>
                  <span className="flex gap-2">
                    {page > 1 && (
                      <Link href={query({ p: page - 1 })} className={ghostButtonClass}>
                        Anteriores
                      </Link>
                    )}
                    {page * PAGE_SIZE < list.total && (
                      <Link href={query({ p: page + 1 })} className={ghostButtonClass}>
                        Siguientes
                      </Link>
                    )}
                  </span>
                </div>
              )}
            </Card>
          )}
        </>
      )}
    </>
  );
}
