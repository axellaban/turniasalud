import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { formatDateTime } from "@/lib/time";
import { Badge, Card, CHANNEL_LABEL, Empty, PageHeader, StatusBadge, smallButtonClass } from "@/components/ui";
import { activeMutes, type ChatMute } from "@/lib/chat-guard";
import { displayPhone } from "@/lib/phone";
import { reactivateChatNumber } from "../../actions";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Conversaciones · Panel" };

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
  const clinic = await getPanelClinic();
  const { canal } = await searchParams;
  const channel = typeof canal === "string" && canal ? canal : null;
  const rows = await sql<Row[]>`
    select c.id, c.started_at, c.channel, c.direction, c.duration_secs, c.title, c.summary, c.intent, c.outcome,
           p.full_name as patient
    from conversations c left join patients p on p.id = c.patient_id
    where c.clinic_id = ${clinic.id} ${channel ? sql`and c.channel = ${channel}` : sql``}
    order by c.started_at desc
    limit 100`;
  const mutes = await activeMutes(clinic.id);

  return (
    <>
      <PageHeader title="Conversaciones" description={`Cada conversación de ${clinic.agent_name || "Sofi"}, con resumen, motivo y resultado.`} />
      {mutes.length > 0 && <MutedNumbers mutes={mutes} clinicId={clinic.id} timezone={clinic.timezone} agent={clinic.agent_name || "Sofi"} />}
      <div className="mb-4 flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <Link
            key={f.key}
            href={f.key ? `/panel/conversaciones?canal=${f.key}` : "/panel/conversaciones"}
            aria-current={(canal ?? "") === f.key ? "page" : undefined}
            className={`rounded-full px-3 py-1 text-sm font-medium ${
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
                  <div className="w-36 shrink-0 text-xs text-brand-900/65">
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
          Todavía no hay conversaciones. Cada charla de {clinic.agent_name || "Sofi"} aparece acá cuando termina, con su resumen y resultado.
        </Empty>
      )}
    </>
  );
}

const MUTE_LABEL: Record<ChatMute["reason"], string> = { bot: "Posible bot", vendedor: "Vendedor o publicidad", exceso: "Exceso de mensajes" };

/** Números a los que Sofi no les contesta por un tiempo (bots, vendedores o exceso de mensajes). */
async function MutedNumbers({ mutes, clinicId, timezone, agent }: { mutes: ChatMute[]; clinicId: string; timezone: string; agent: string }) {
  const names = new Map(
    (await sql<{ phone: string; full_name: string | null }[]>`
      select phone, full_name from patients where clinic_id = ${clinicId} and phone = any(${mutes.map((m) => m.phone)})`).map((p) => [p.phone, p.full_name]),
  );
  return (
    <Card className="mb-6 p-0">
      <div className="px-5 pt-4">
        <h2 className="font-medium text-brand-950">Números en pausa</h2>
        <p className="mt-1 text-sm text-brand-900/60">
          {agent} no les contesta por un tiempo: bots que se responden solos, vendedores o alguien que escribió sin parar. Si es un paciente, reactivalo.
        </p>
      </div>
      <ul className="mt-3 divide-y divide-brand-900/5 border-t border-brand-900/5">
        {mutes.map((m) => (
          <li key={m.phone} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-brand-950">
                {names.get(m.phone) ?? displayPhone(m.phone)} <Badge tone={m.reason === "exceso" ? "yellow" : "gray"}>{MUTE_LABEL[m.reason]}</Badge>
              </p>
              <p className="text-sm text-brand-900/60">
                {m.detail ? `${m.detail} ` : ""}Hasta el {formatDateTime(m.until, timezone)}.
              </p>
            </div>
            <form action={reactivateChatNumber}>
              <input type="hidden" name="clinic_id" value={clinicId} />
              <input type="hidden" name="phone" value={m.phone} />
              <button className={smallButtonClass}>Reactivar</button>
            </form>
          </li>
        ))}
      </ul>
    </Card>
  );
}
