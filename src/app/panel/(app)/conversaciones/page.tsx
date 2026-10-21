import Link from "next/link";
import { sql } from "@/lib/db";
import { getClinic } from "@/lib/clinic";
import { formatDateTime } from "@/lib/time";
import { Badge, Card, CHANNEL_LABEL, Empty, PageHeader, StatusBadge } from "@/components/ui";

type Row = {
  id: string;
  started_at: string;
  channel: string;
  direction: string;
  duration_secs: number | null;
  title: string | null;
  summary: string | null;
  intent: string | null;
  outcome: string | null;
  patient: string | null;
};

const FILTERS = [
  { key: "", label: "Todas" },
  { key: "whatsapp", label: "WhatsApp" },
  { key: "telefono", label: "Teléfono" },
  { key: "web", label: "Web" },
];

export default async function ConversationsPage({ searchParams }: PageProps<"/panel/conversaciones">) {
  const clinic = await getClinic();
  const { canal } = await searchParams;
  const channel = typeof canal === "string" && canal ? canal : null;
  const rows = await sql<Row[]>`
    select c.id, c.started_at, c.channel, c.direction, c.duration_secs, c.title, c.summary, c.intent, c.outcome,
           p.full_name as patient
    from conversations c left join patients p on p.id = c.patient_id
    where c.clinic_id = ${clinic.id} ${channel ? sql`and c.channel = ${channel}` : sql``}
    order by c.started_at desc
    limit 100`;

  return (
    <>
      <PageHeader title="Conversaciones" description="Cada conversación del agente, con resumen, motivo y resultado." />
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/panel/conversaciones?canal=${f.key}` : "/panel/conversaciones"}
            className={`rounded-full px-3 py-1 text-sm ${
              (canal ?? "") === f.key ? "bg-brand-600 text-white" : "bg-white text-brand-800 ring-1 ring-brand-200"
            }`}
          >
            {f.label}
          </Link>
        ))}
      </div>
      {rows.length ? (
        <Card className="p-0">
          <ul className="divide-y divide-brand-900/5">
            {rows.map((c) => (
              <li key={c.id}>
                <Link href={`/panel/conversaciones/${c.id}`} className="flex flex-col gap-1 px-5 py-4 hover:bg-brand-50/60 sm:flex-row sm:items-center sm:gap-4">
                  <div className="w-36 shrink-0 text-xs text-brand-900/55">
                    <p>{formatDateTime(c.started_at, clinic.timezone)}</p>
                    <p>
                      {CHANNEL_LABEL[c.channel]} {c.direction === "saliente" && "· saliente"}
                    </p>
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-brand-950">{c.patient ?? "Paciente sin identificar"}</p>
                    <p className="line-clamp-2 text-sm text-brand-900/60">{c.title || c.summary || "Sin resumen todavía"}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {c.intent && <Badge>{c.intent.replace(/_/g, " ")}</Badge>}
                    <StatusBadge value={c.outcome} />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      ) : (
        <Empty>
          Todavía no hay conversaciones registradas. Aparecen acá cuando termina cada conversación (webhook post-conversación de
          ElevenLabs).
        </Empty>
      )}
    </>
  );
}
