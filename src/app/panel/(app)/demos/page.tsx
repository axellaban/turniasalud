import { selectClinic } from "../../clinics-actions";
import { requireAdmin } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { isLeadStatus, LEAD_STATUSES, type LeadStatus } from "@/lib/leads";
import { Badge, Card, Empty, PageHeader, Stat, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { FollowupForm } from "./followup-form";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Pedidos de demo · Panel" };

type Lead = {
  id: string; name: string; email: string | null; phone: string | null; organization: string | null;
  role: string | null; specialty: string | null; size: string | null; message: string | null;
  source: string | null; created_at: string; updated_at: string; status: LeadStatus; notes: string | null;
};
const PAGE_SIZE = 30;

type DemoActivity = {
  id: string; lead_id: string; website: string; status: string; pages_read: number | null; error: string | null;
  clinic_id: string | null; clinic_name: string | null; created_at: string;
};
type DemoConversation = {
  clinic_id: string; channel: string; started_at: string;
  transcript: Array<{ role: string; message: string | null }> | null;
};
const DEMO_STATUS: Record<string, string> = {
  analizando: "Leyendo la web", eligiendo: "Eligiendo modo", llamada: "En llamada", audio: "Probando audios",
  chat: "Probando chat", terminada: "Terminada", error: "No se pudo leer la web",
};

/** Lo que hizo cada interesado en la demo (WhatsApp, Telegram o navegador): web, estado y conversaciones con el agente. */
async function demoActivity(leadIds: string[]) {
  if (!leadIds.length) return { sessions: [] as DemoActivity[], conversations: [] as DemoConversation[] };
  try {
    const sessions = await sql<DemoActivity[]>`
      select ds.id, ds.lead_id, ds.website, ds.status, ds.pages_read, ds.error, ds.clinic_id, c.name as clinic_name, ds.created_at
      from demo_sessions ds left join clinics c on c.id = ds.clinic_id
      where ds.lead_id in ${sql(leadIds)} order by ds.created_at`;
    const clinicIds = [...new Set(sessions.map((x) => x.clinic_id).filter((x): x is string => Boolean(x)))];
    const conversations = clinicIds.length
      ? await sql<DemoConversation[]>`
          select clinic_id, channel, started_at, transcript from conversations
          where clinic_id in ${sql(clinicIds)} order by started_at`
      : [];
    return { sessions: [...sessions], conversations: [...conversations] };
  } catch (e) {
    // La base todavía no tiene las tablas de la demo (se crean en el próximo deploy de producción).
    console.error("Pedidos de demo: no se pudo leer la actividad de las demos", e instanceof Error ? e.message : e);
    return { sessions: [], conversations: [] };
  }
}

export default async function DemoRequestsPage({ searchParams }: PageProps<"/panel/demos">) {
  await requireAdmin();
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
  const activity = await demoActivity(rows.filter((r) => (r.source === "demo-whatsapp" || r.source === "demo-telegram" || r.source === "demo-web")).map((r) => r.id));
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
            <p className="mt-2 text-xs text-brand-900/65">Recibido: {formatDateTime(lead.created_at, "America/Argentina/Buenos_Aires")}</p>
            <dl className="my-4 grid gap-2 text-sm">
              {lead.email && <div><dt className="font-medium text-brand-900">Email</dt><dd><a href={`mailto:${lead.email}`} className="break-all text-brand-600 underline">{lead.email}</a></dd></div>}
              {lead.phone && <div><dt className="font-medium text-brand-900">{lead.source === "demo-telegram" ? "Usuario de Telegram" : "Teléfono / WhatsApp"}</dt><dd className="break-words">{/^\d{8,15}$/.test(lead.phone) ? <a href={`https://wa.me/${lead.phone}`} className="text-brand-600 underline">+{lead.phone}</a> : lead.phone}</dd></div>}
              <div><dt className="font-medium text-brand-900">Especialidad y equipo</dt><dd>{[lead.specialty, lead.size, lead.role].filter(Boolean).join(" · ") || "Sin indicar"}</dd></div>
              {lead.message && <div><dt className="font-medium text-brand-900">{lead.source === "demo-telegram" ? "Demo por Telegram" : lead.source === "demo-whatsapp" ? "Demo por WhatsApp" : lead.source === "demo-web" ? "Demo en el navegador" : "Qué busca resolver"}</dt><dd className="whitespace-pre-wrap break-words text-brand-900/75">{lead.message}</dd></div>}
              {lead.source && <div><dt className="font-medium text-brand-900">Origen</dt><dd className="break-all text-brand-900/60">{lead.source}</dd></div>}
            </dl>
            <DemoDetails sessions={activity.sessions.filter((x) => x.lead_id === lead.id)} conversations={activity.conversations} />
            <FollowupForm id={lead.id} status={lead.status} notes={lead.notes} />
          </Card>
        ))}
      </div> : <Empty>{q || status ? "No hay pedidos con estos filtros." : "Todavía no hay pedidos de demo. Aparecen acá cuando alguien completa el formulario de la web o prueba la demo por chat."}</Empty>}
      <nav aria-label="Páginas de pedidos de demo" className="mt-6 flex items-center justify-between gap-3">
        {page > 1 ? <Link href={pageUrl(page - 1)} className={secondaryButtonClass}>Anterior</Link> : <span />}
        <span className="text-sm text-brand-900/60">Página {page}</span>
        {page * PAGE_SIZE < filtered.count ? <Link href={pageUrl(page + 1)} className={secondaryButtonClass}>Siguiente</Link> : <span />}
      </nav>
    </>
  );
}

function DemoDetails({ sessions, conversations }: { sessions: DemoActivity[]; conversations: DemoConversation[] }) {
  if (!sessions.length) return null;
  return (
    <details className="mb-4 rounded-xl bg-brand-50/60 p-3 text-sm">
      <summary className="cursor-pointer font-medium text-brand-900">Lo que probó en la demo ({sessions.length})</summary>
      <div className="mt-3 space-y-4">
        {sessions.map((demo) => {
          const chats = demo.clinic_id ? conversations.filter((c) => c.clinic_id === demo.clinic_id) : [];
          return (
            <div key={demo.id}>
              <p className="flex flex-wrap items-center gap-2">
                <a href={demo.website} target="_blank" rel="noreferrer" className="break-all text-brand-600 underline">{demo.website}</a>
                <Badge tone={demo.status === "error" ? "yellow" : "gray"}>{DEMO_STATUS[demo.status] ?? demo.status}</Badge>
              </p>
              <p className="mt-1 text-xs text-brand-900/60">
                {formatDateTime(demo.created_at, "America/Argentina/Buenos_Aires")}
                {demo.pages_read ? ` · leyó ${demo.pages_read} página${demo.pages_read === 1 ? "" : "s"}` : ""}
                {demo.clinic_name ? ` · clínica armada: ${demo.clinic_name}` : ""}
                {demo.error ? ` · ${demo.error}` : ""}
                {!demo.clinic_id && demo.pages_read ? " · la clínica temporal ya se limpió" : ""}
                {!demo.clinic_id && !demo.pages_read && demo.status === "terminada" ? " · terminó antes de preparar la clínica" : ""}
              </p>
              {demo.clinic_id && <form action={selectClinic} className="mt-2"><input type="hidden" name="clinic_id" value={demo.clinic_id} /><button className={buttonClass}>Abrir configuración de la clínica</button></form>}
              {chats.map((c, i) => (
                <div key={i} className="mt-2 space-y-1 rounded-lg bg-white p-2 text-xs">
                  <p className="font-medium text-brand-900/70">{c.channel === "telefono" ? "Llamada telefónica" : "Conversación"} · {formatDateTime(c.started_at, "America/Argentina/Buenos_Aires")}</p>
                  {(c.transcript ?? []).filter((t) => t.message).map((t, j) => (
                    <p key={j} className="whitespace-pre-wrap break-words">
                      <span className="font-semibold">{t.role === "agent" ? "Agente" : "Interesado"}:</span> {t.message}
                    </p>
                  ))}
                </div>
              ))}
            </div>
          );
        })}
      </div>
    </details>
  );
}
