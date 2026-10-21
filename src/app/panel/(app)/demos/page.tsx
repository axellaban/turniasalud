import Link from "next/link";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { isLeadStatus, LEAD_STATUSES, type LeadStatus } from "@/lib/leads";
import { Badge, Card, Empty, PageHeader, Stat, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { FollowupForm } from "./followup-form";

type Lead = {
  id: string; name: string; email: string; phone: string | null; organization: string | null;
  role: string | null; specialty: string | null; size: string | null; message: string | null;
  source: string | null; created_at: string; updated_at: string; status: LeadStatus; notes: string | null;
};
const PAGE_SIZE = 30;

export default async function DemoRequestsPage({ searchParams }: PageProps<"/panel/demos">) {
  const params = await searchParams;
  const q = typeof params.q === "string" ? params.q.trim().slice(0, 160) : "";
  const status = isLeadStatus(params.estado) ? params.estado : null;
  const requestedPage = typeof params.pagina === "string" ? Number(params.pagina) : 1;
  const page = Number.isSafeInteger(requestedPage) && requestedPage > 0 ? Math.min(requestedPage, 10000) : 1;
  const where = sql`where true ${status ? sql`and status = ${status}` : sql``}
    ${q ? sql`and strpos(lower(concat_ws(' ', name, email, phone, organization, specialty)), lower(${q})) > 0` : sql``}`;
  const [rows, [totals], [filtered]] = await Promise.all([
    sql<Lead[]>`select id, name, email, phone, organization, role, specialty, size, message, source,
      created_at, updated_at, status, notes from leads ${where}
      order by created_at desc, id desc limit ${PAGE_SIZE} offset ${(page - 1) * PAGE_SIZE}`,
    sql<{ total: number; nuevos: number; agendadas: number }[]>`select count(*)::int as total,
      count(*) filter (where status = 'nuevo')::int as nuevos,
      count(*) filter (where status = 'demo_agendada')::int as agendadas from leads`,
    sql<{ count: number }[]>`select count(*)::int as count from leads ${where}`,
  ]);
  const pageUrl = (n: number) => `/panel/demos?${new URLSearchParams({ ...(q ? { q } : {}), ...(status ? { estado: status } : {}), pagina: String(n) })}`;

  return (
    <>
      <PageHeader title="Pedidos de demo" description="Los contactos que llegan desde la web, con su mensaje y seguimiento comercial." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Stat label="Pedidos recibidos" value={totals.total} />
        <Stat label="Por contactar" value={totals.nuevos} />
        <Stat label="Demos agendadas" value={totals.agendadas} />
      </div>
      <form action="/panel/demos" className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex-1 text-sm font-medium text-brand-900">Buscar contacto
          <input name="q" defaultValue={q} placeholder="Nombre, email, clínica o especialidad" className={`mt-1 ${inputClass}`} />
        </label>
        <label className="text-sm font-medium text-brand-900">Estado
          <select name="estado" defaultValue={status ?? ""} className={`mt-1 ${inputClass}`}>
            <option value="">Todos</option>
            {Object.entries(LEAD_STATUSES).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </label>
        <button className={buttonClass}>Filtrar</button>
        {(q || status) && <Link href="/panel/demos" className={secondaryButtonClass}>Limpiar</Link>}
      </form>
      <p className="mb-4 text-sm text-brand-900/60">{filtered.count} pedido{filtered.count === 1 ? "" : "s"}{(q || status) ? " con estos filtros" : " en total"}.</p>
      {rows.length ? <div className="grid items-start gap-4 xl:grid-cols-2">
        {rows.map((lead) => (
          <Card key={lead.id}>
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <h2 className="break-words text-lg font-semibold text-brand-950">{lead.name}</h2>
                <p className="text-sm text-brand-900/60">{lead.organization || "Clínica sin indicar"}</p>
              </div>
              <Badge tone={lead.status === "nuevo" ? "yellow" : lead.status === "ganado" ? "green" : "gray"}>{LEAD_STATUSES[lead.status]}</Badge>
            </div>
            <p className="mt-2 text-xs text-brand-900/50">Recibido: {formatDateTime(lead.created_at, "America/Argentina/Buenos_Aires")}</p>
            <dl className="my-4 grid gap-2 text-sm">
              <div><dt className="font-medium text-brand-900">Email</dt><dd><a href={`mailto:${lead.email}`} className="break-all text-brand-600 underline">{lead.email}</a></dd></div>
              {lead.phone && <div><dt className="font-medium text-brand-900">Teléfono / WhatsApp</dt><dd className="break-words">{lead.phone}</dd></div>}
              <div><dt className="font-medium text-brand-900">Especialidad y equipo</dt><dd>{[lead.specialty, lead.size, lead.role].filter(Boolean).join(" · ") || "Sin indicar"}</dd></div>
              {lead.message && <div><dt className="font-medium text-brand-900">Qué busca resolver</dt><dd className="whitespace-pre-wrap break-words text-brand-900/75">{lead.message}</dd></div>}
              {lead.source && <div><dt className="font-medium text-brand-900">Origen</dt><dd className="break-all text-brand-900/60">{lead.source}</dd></div>}
            </dl>
            <FollowupForm id={lead.id} status={lead.status} notes={lead.notes} />
          </Card>
        ))}
      </div> : <Empty>{q || status ? "No hay pedidos con estos filtros." : "Todavía no hay pedidos de demo. Aparecen acá cuando alguien completa el formulario de la web."}</Empty>}
      <nav aria-label="Páginas de pedidos de demo" className="mt-6 flex items-center justify-between gap-3">
        {page > 1 ? <Link href={pageUrl(page - 1)} className={secondaryButtonClass}>Anterior</Link> : <span />}
        <span className="text-sm text-brand-900/60">Página {page}</span>
        {page * PAGE_SIZE < filtered.count ? <Link href={pageUrl(page + 1)} className={secondaryButtonClass}>Siguiente</Link> : <span />}
      </nav>
    </>
  );
}
