import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { CAMPAIGN_LABELS, audienceBreakdown, campaignMessage, campaignRule, campaignStats, computeAudience, EMPTY_STATS, firstName, opportunities, type Opportunity } from "@/lib/campaigns";
import { activeCampaigns, campaignQueue, campaignResults, PERIODS, stepRate, type Period, type QueueFilter } from "@/lib/campaign-board";
import { DAILY_LINE_CAP, DEFAULT_FOLLOWUP_DAYS, DEFAULT_MAX_MESSAGES, LOT_SIZE, PILOT_SIZE, SEND_WINDOW, lineUsage } from "@/lib/campaign-limits";
import { DEFAULT_FOLLOWUP_TEXT } from "@/lib/campaign-sequences";
import { describeRules, parseRules } from "@/lib/audience-rules";
import { listSavedAudiences } from "@/lib/saved-audiences";
import { OPT_OUT_FOOTER } from "@/lib/whatsapp";
import { formatDate } from "@/lib/time";
import { readWaitlist } from "@/lib/waitlist";
import { ATTRIBUTION_DAYS, type AppointmentType, type AutoCampaignType, type Campaign, type CampaignType } from "@/lib/types";
import { campaignFromSavedAudienceAction, prepareCampaignAction, toggleRecipientAction } from "../../campaign-actions";
import { Badge, Card, Field, Notice, PageHeader, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { AutoToggle } from "./auto-toggle";
import { CampaignSettings } from "./campaign-settings";
import { ContactRules } from "./contact-rules";
import { RecallSelect } from "./recall-select";
import { CAMPAIGN_STATUS, money, plural } from "./labels";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Campañas · Panel" };

/** Lo que corre solo (lo dispara n8n) en las clínicas que lo tienen prendido. */
const AUTOMATIC: Array<[AutoCampaignType, string]> = [
  ["recordatorio", "Todos los días a las 10"],
  ["no_show", "Todos los días a las 18"],
  ["encuesta", "Todos los días a las 19"],
  ["recall", "Los lunes a las 11"],
  ["reactivacion", "El 1 de cada mes a las 11"],
];

const ACTIVE_STATUS: Record<Campaign["status"], { label: string; tone: "yellow" | "blue" | "green" }> = {
  borrador: { label: "Borrador", tone: "yellow" },
  enviando: { label: "Activa", tone: "blue" },
  finalizada: { label: "Enviada", tone: "green" },
};

const initials = (name: string) =>
  name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

const shortName = (name: string) => {
  const [first, last] = name.split(/\s+/);
  return last ? `${first} ${last[0]}.` : first;
};

/** Una audiencia: cuántos, cuánto valen en turnos y una sola acción. */
function AudienceCard({
  title,
  o,
  clinicId,
  note,
  empty,
}: {
  title: string;
  o: Opportunity;
  clinicId: string;
  note?: string;
  empty?: React.ReactNode;
}) {
  const count = o.members.length;
  return (
    <article className="flex min-h-40 flex-col rounded-2xl border border-brand-900/10 bg-white p-4">
      <span className="text-xs text-brand-900/65">{title}</span>
      <strong className="mt-1 font-display text-3xl text-brand-950 tabular-nums">{count.toLocaleString("es-AR")}</strong>
      <span className="text-xs text-brand-900/65">
        {o.value > 0 ? `≈ ${money.format(o.value)} en turnos` : count ? "Sin precio de referencia" : ""}
        {note ? `${o.value > 0 || count ? " · " : ""}${note}` : ""}
      </span>
      {count === 0 && empty && <span className="mt-1 text-xs text-brand-900/70">{empty}</span>}
      <div className="mt-auto pt-3 text-sm font-semibold">
        {o.open ? (
          <Link href={`/panel/campanas?campana=${o.open.id}#campana`} className="text-brand-700 hover:underline">
            {o.open.status === "borrador" ? "Seguir el borrador" : "Campaña activa"} ↗
          </Link>
        ) : count > 0 ? (
          <form action={prepareCampaignAction}>
            <input type="hidden" name="clinic_id" value={clinicId} />
            <input type="hidden" name="type" value={o.type} />
            <button className="text-brand-700 hover:underline">Crear campaña +</button>
          </form>
        ) : (
          <span className="font-normal text-brand-900/50">Nadie por ahora</span>
        )}
      </div>
    </article>
  );
}

function Stage({ label, value, rate, width }: { label: string; value: number; rate: number | null; width: number }) {
  return (
    <div className="min-w-0">
      <span className="text-xs text-brand-900/65">{label}</span>
      <strong className="mt-1 flex items-baseline gap-1.5 font-display text-2xl text-brand-950 tabular-nums">
        {value.toLocaleString("es-AR")}
        {rate !== null && <small className="font-sans text-xs font-semibold text-brand-700">{rate}%</small>}
      </strong>
      <span className="mt-2 block h-1.5 overflow-hidden rounded-full bg-brand-50" aria-hidden>
        <span className="block h-full rounded-full bg-brand-500" style={{ width: `${width}%` }} />
      </span>
    </div>
  );
}

const QUEUE_FILTERS: Array<[QueueFilter, string]> = [
  ["hoy", "Para hoy"],
  ["fuera", "Fuera de la cola"],
  ["todos", "Todos"],
];

const STEP_TONE: Record<string, string> = {
  cola: "bg-brand-50 text-brand-800",
  sofi: "bg-emerald/15 text-emerald-700",
  fuera: "bg-neutral-100 text-neutral-700",
  hecho: "bg-neutral-100 text-neutral-700",
};

export default async function CampaignsPage(props?: PageProps<"/panel/campanas">) {
  const params = (await props?.searchParams) ?? {};
  const pick = (key: string) => (typeof params[key] === "string" ? (params[key] as string) : undefined);
  const period: Period = (["30", "mes", "todo"] as const).find((p) => p === pick("periodo")) ?? "30";
  const filter: QueueFilter = (["hoy", "fuera", "todos"] as const).find((f) => f === pick("cola")) ?? "hoy";

  const [clinic, user] = await Promise.all([getPanelClinic(), getPanelUser()]);
  const isAdmin = user.role === "admin";
  const autoOn = new Set(clinic.auto_campaigns ?? []);
  const [opp, campaigns, active, [base], types, usage, saved, waitlist] = await Promise.all([
    opportunities(clinic),
    sql<Campaign[]>`select * from campaigns where clinic_id = ${clinic.id} order by created_at desc limit 30`,
    activeCampaigns(clinic.id),
    sql<Array<{ total: number; reachable: number; with_history: number }>>`
      select count(*)::int as total,
        count(*) filter (where p.phone is not null and not p.contact_opt_out)::int as reachable,
        count(*) filter (where exists (select 1 from appointments a where a.patient_id = p.id and a.status = 'atendido')
          or exists (select 1 from patient_visits v where v.patient_id = p.id))::int as with_history
      from patients p where p.clinic_id = ${clinic.id}`,
    sql<AppointmentType[]>`select * from appointment_types where clinic_id = ${clinic.id} and active order by specialty, name`,
    lineUsage(clinic),
    listSavedAudiences(clinic.id),
    readWaitlist(clinic.id),
  ]);
  // Audiencias propias guardadas: cuántos y cuánto valen hoy (las primeras 4).
  const savedCards = await Promise.all(
    saved.slice(0, 4).map(async (a) => {
      const members = (await computeAudience(clinic, "audiencia", undefined, a.rules)).filter((m) => m.reachable);
      return { ...a, count: members.length, value: members.reduce((sum, m) => sum + (m.value ?? 0), 0) };
    }),
  );
  const byType = new Map(opp.list.map((o) => [o.type, o]));
  const recall = byType.get("recall")!;
  const dueByType = new Map<string, number>();
  for (const m of recall.members) if (m.appointment_type_id) dueByType.set(m.appointment_type_id, (dueByType.get(m.appointment_type_id) ?? 0) + 1);
  const withRecall = types.filter((t) => t.recall_months).length;
  const needsBase = base.total === 0 || base.with_history < base.total / 2;

  // La campaña que se mira abajo: la elegida, o la primera activa, o la última que se mandó.
  const selectedId = pick("campana");
  const selected = campaigns.find((c) => c.id === selectedId) ?? active[0] ?? campaigns[0] ?? null;
  const finished = campaigns.filter((c) => !active.some((a) => a.id === c.id));
  const stats = await campaignStats(clinic.id, finished.map((c) => c.id));

  const [results, queue, breakdown, steps, sampleRow] = selected
    ? await Promise.all([
        campaignResults(clinic, selected.id, period),
        campaignQueue(clinic, selected, filter),
        selected.type === "personalizada" ? Promise.resolve(null) : audienceBreakdown(clinic, selected.type, parseRules(selected.audience_rules)),
        sql<Array<{ position: number; delay_days: number; message: string | null }>>`select position, delay_days, message from campaign_steps where campaign_id = ${selected.id} order by position`,
        sql<Array<{ name: string | null; detail: string | null }>>`
          select p.full_name as name, r.detail from campaign_recipients r join patients p on p.id = r.patient_id
          where r.campaign_id = ${selected.id} and r.detail is not null order by r.created_at limit 1`,
      ])
    : [null, null, null, [], []];
  const followupStep = steps.find((s) => s.position === 2);
  const sample = { name: firstName(sampleRow[0]?.name ?? "Lucía"), detail: sampleRow[0]?.detail ?? CAMPAIGN_LABELS[selected?.type ?? "recall"].title.toLowerCase() };
  const qs = (patch: Record<string, string>) => {
    const next = new URLSearchParams({ ...(selected ? { campana: selected.id } : {}), periodo: period, cola: filter, ...patch });
    return `/panel/campanas?${next.toString()}`;
  };

  const dailyLine = (type: CampaignType) => {
    if (type === "recordatorio" && clinic.external_reminders) return <b className="text-brand-950">lo manda {clinic.external_reminders}</b>;
    const on = autoOn.has(type as AutoCampaignType);
    return <b className={on ? "text-emerald-700" : "text-brand-950"}>{on ? "prendido" : "apagado"}</b>;
  };

  return (
    <>
      <PageHeader
        title="Campañas"
        description="Sofi les escribe a tus pacientes para que vuelvan a sacar turno, y te muestra cuántos volvieron."
        actions={
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-52 rounded-xl border border-brand-900/10 bg-white px-3 py-2 text-xs text-brand-900/70">
              <span className="flex justify-between gap-3">
                <span>WhatsApp del consultorio · hoy</span>
                <b className="text-brand-950 tabular-nums">{usage.capped ? `${usage.sent} de ${usage.cap}` : `${usage.sent} · sin tope`}</b>
              </span>
              {usage.capped && (
                <span className="mt-1.5 block h-1 overflow-hidden rounded-full bg-brand-50" aria-hidden>
                  <span className={`block h-full rounded-full ${usage.left === 0 ? "bg-sun-500" : "bg-brand-500"}`} style={{ width: `${Math.min(100, (usage.sent / usage.cap) * 100)}%` }} />
                </span>
              )}
            </div>
            <Link href="/panel/campanas/audiencia" className={buttonClass}>
              + Nueva campaña
            </Link>
          </div>
        }
      />
      {clinic.is_demo && (
        <Notice tone="info" className="mb-6">
          Es un perfil de demo: podés importar pacientes y armar campañas para ver la lista y el mensaje, pero Sofi no envía nada desde acá.
        </Notice>
      )}

      <section aria-labelledby="audiencias-titulo" id="audiencias" className="mb-8">
        <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="audiencias-titulo" className="font-semibold text-brand-950">Audiencias</h2>
          <span className="text-xs text-brand-900/65">Se recalculan solas con la agenda{clinic.external_reminders ? ` y ${clinic.external_reminders}` : ""}.</span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <article className="flex min-h-40 flex-col rounded-2xl border border-brand-900/10 bg-white p-4">
            <span className="text-xs text-brand-900/65">Base de pacientes</span>
            <strong className="mt-1 font-display text-3xl text-brand-950 tabular-nums">{base.total.toLocaleString("es-AR")}</strong>
            <span className="text-xs text-brand-900/65">{base.reachable.toLocaleString("es-AR")} con WhatsApp</span>
            <div className="mt-auto pt-3 text-sm font-semibold">
              <Link href={needsBase ? "/panel/pacientes/importar" : "/panel/pacientes"} className="text-brand-700 hover:underline">
                {needsBase ? "Importar pacientes" : "Ver pacientes"}
              </Link>
            </div>
          </article>
          <AudienceCard
            title="Controles vencidos"
            o={recall}
            clinicId={clinic.id}
            empty={withRecall === 0 ? <a href="#controles" className="underline underline-offset-2">Definí cada cuánto vuelve cada prestación</a> : undefined}
          />
          <AudienceCard title="Faltaron y no volvieron" o={byType.get("no_show")!} clinicId={clinic.id} note="últimos 30 días" />
          <article className="flex min-h-40 flex-col rounded-2xl border border-dashed border-brand-900/15 bg-white/60 p-4">
            <span className="text-xs text-brand-900/65">Presupuestos sin iniciar</span>
            <strong className="mt-1 font-display text-3xl text-brand-900/40">—</strong>
            <span className="text-xs text-brand-900/65">{clinic.external_reminders ? `${clinic.external_reminders} no lo informa todavía` : "Falta el origen de los presupuestos"}</span>
            <div className="mt-auto pt-3 text-sm font-semibold">
              <Link href="/panel/configuracion" className="text-brand-700 hover:underline">
                Conectar origen
              </Link>
            </div>
          </article>
          <AudienceCard
            title={`Inactivos +${clinic.reactivation_months} meses`}
            o={byType.get("reactivacion")!}
            clinicId={clinic.id}
            empty={base.with_history === 0 ? <Link href="/panel/pacientes/importar" className="underline underline-offset-2">Importá la base con sus visitas</Link> : undefined}
          />
          <article className="flex min-h-40 flex-col rounded-2xl border border-brand-900/10 bg-white p-4">
            <span className="text-xs text-brand-900/65">Lista de espera</span>
            <strong className="mt-1 font-display text-3xl text-brand-950 tabular-nums">{waitlist.total.toLocaleString("es-AR")}</strong>
            <span className="text-xs text-brand-900/65">Los avisos automáticos van solo a quienes los pidieron</span>
            <div className="mt-auto pt-3">
              <Badge tone="blue">Con turno y sin turno</Badge>
              <Link href="/panel/lista-espera" className="ml-3 text-sm font-semibold text-brand-700 hover:underline">Ver lista →</Link>
            </div>
          </article>
          {savedCards.map((a) => (
            <article key={a.id} className="flex min-h-40 flex-col rounded-2xl border border-brand-900/10 bg-white p-4">
              <span className="line-clamp-2 text-xs text-brand-900/65">{a.name}</span>
              <strong className="mt-1 font-display text-3xl text-brand-950 tabular-nums">{a.count.toLocaleString("es-AR")}</strong>
              <span className="text-xs text-brand-900/65">{a.value > 0 ? `≈ ${money.format(a.value)} en turnos` : "Audiencia propia"}</span>
              <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-3 text-sm font-semibold">
                {a.count > 0 && (
                  <form action={campaignFromSavedAudienceAction}>
                    <input type="hidden" name="clinic_id" value={clinic.id} />
                    <input type="hidden" name="id" value={a.id} />
                    <button className="text-brand-700 hover:underline">Crear campaña +</button>
                  </form>
                )}
                <Link href={`/panel/campanas/audiencia?id=${a.id}`} className="font-normal text-brand-900/65 hover:underline">
                  Editar
                </Link>
              </div>
            </article>
          ))}
          <Link
            href="/panel/campanas/audiencia"
            className="flex min-h-40 flex-col items-center justify-center gap-1 rounded-2xl border border-dashed border-brand-300 bg-brand-50/40 p-4 text-sm font-semibold text-brand-800 hover:bg-brand-50"
          >
            <span className="text-2xl leading-none">+</span>
            Nueva audiencia
          </Link>
        </div>
      </section>

      <section aria-labelledby="campanas-titulo" className="mb-8">
        <h2 id="campanas-titulo" className="mb-3 font-semibold text-brand-950">Campañas</h2>
        {active.length ? (
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {active.map((c) => {
              const status = ACTIVE_STATUS[c.status];
              const isSelected = selected?.id === c.id;
              const pending = c.status === "borrador" ? `${plural(c.listed, "paciente", "pacientes")} en la lista` : `${c.queued} en cola`;
              const stepsLabel = c.steps > 1 ? `${c.steps} pasos` : "1 paso · sin seguimiento";
              return (
                <li key={c.id}>
                  <Link
                    href={`/panel/campanas?campana=${c.id}#campana`}
                    aria-current={isSelected ? "true" : undefined}
                    className={`block h-full rounded-2xl border bg-white p-4 transition hover:border-brand-300 ${isSelected ? "border-brand-500 ring-2 ring-brand-500/20" : "border-brand-900/10"}`}
                  >
                    <span className="flex items-start justify-between gap-2">
                      <b className="min-w-0 truncate text-brand-950">{c.name}</b>
                      <span className="flex shrink-0 gap-1.5">
                        {c.automatic && <Badge tone="blue">Automática</Badge>}
                        <Badge tone={status.tone}>{status.label}</Badge>
                      </span>
                    </span>
                    <span className="mt-1 block text-xs text-brand-900/65">
                      {pending} · {stepsLabel}
                      {c.next_followup ? ` · próximo seguimiento ${formatDate(c.next_followup, clinic.timezone)}` : ""}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="rounded-2xl border border-dashed border-brand-900/15 p-5 text-sm text-brand-900/65">
            No hay campañas en curso. Elegí una audiencia de arriba: vas a poder revisar a quiénes les llega y el mensaje antes de enviar.
          </p>
        )}
        <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl bg-brand-50/60 px-4 py-2.5 text-sm text-brand-900/75">
          <span className="font-semibold text-brand-950">Del día a día:</span>
          <span>Recordatorio de turno · {dailyLine("recordatorio")}</span>
          <span>Encuesta post-consulta · {dailyLine("encuesta")}</span>
          <span>
            Turno liberado a la lista de espera · <b className="text-emerald-700">prendido</b>
          </span>
          <a href="#automaticas" className="font-semibold text-brand-700 hover:underline">
            Cambiar
          </a>
        </p>
      </section>

      {selected && results && queue ? (
        <div id="campana" className="grid scroll-mt-6 grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0 space-y-6">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="font-semibold text-brand-950">Resultados · {selected.name}</h2>
                <nav aria-label="Período" className="flex flex-wrap gap-1 text-xs">
                  {PERIODS.map(([key, label]) => (
                    <Link
                      key={key}
                      href={`${qs({ periodo: key })}#campana`}
                      aria-current={period === key ? "true" : undefined}
                      className={`rounded-full px-3 py-1.5 font-semibold ${period === key ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-800 hover:bg-brand-100"}`}
                    >
                      {label}
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stage label="Contactados" value={results.contacted} rate={null} width={results.contacted ? 100 : 0} />
                <Stage label="Respondieron" value={results.replied} rate={stepRate(results.replied, results.contacted)} width={stepRate(results.replied, results.contacted) ?? 0} />
                <Stage label="Sacaron turno" value={results.booked} rate={stepRate(results.booked, results.replied)} width={stepRate(results.booked, results.contacted) ?? 0} />
                <Stage label="Vinieron" value={results.attended} rate={stepRate(results.attended, results.booked)} width={stepRate(results.attended, results.contacted) ?? 0} />
              </div>
              <div className="mt-4 flex flex-col gap-1 border-t border-brand-900/5 pt-3 text-xs text-brand-900/70 sm:flex-row sm:justify-between sm:gap-4">
                <span>
                  <b className="text-brand-950">{money.format(results.attendedValue)}</b> en turnos atendidos, con el precio de referencia de cada prestación
                </span>
                <span>
                  Cuenta un turno si lo sacó dentro de los <b className="text-brand-950">{ATTRIBUTION_DAYS} días</b> del mensaje, por cualquier canal
                </span>
              </div>
            </Card>

            <Card className="!p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
                <div>
                  <h2 className="font-semibold text-brand-950">Cola de envíos</h2>
                  <p className="mt-0.5 text-xs text-brand-900/65">
                    Lo que sale solo, de lunes a viernes de {SEND_WINDOW.from} a {SEND_WINDOW.to}, como mucho {DAILY_LINE_CAP} mensajes por día desde esta línea.
                  </p>
                </div>
                <nav aria-label="Qué mostrar" className="flex flex-wrap gap-1 text-xs">
                  {QUEUE_FILTERS.map(([key, label]) => (
                    <Link
                      key={key}
                      href={`${qs({ cola: key })}#campana`}
                      aria-current={filter === key ? "true" : undefined}
                      className={`rounded-full px-3 py-1.5 font-semibold ${filter === key ? "bg-brand-600 text-white" : "bg-brand-50 text-brand-800 hover:bg-brand-100"}`}
                    >
                      {label}
                      {key === "fuera" && queue.counts.fuera ? ` (${queue.counts.fuera})` : ""}
                    </Link>
                  ))}
                </nav>
              </div>
              {queue.rows.length ? (
                <ul className="divide-y divide-brand-900/5 border-t border-brand-900/5">
                  {queue.rows.slice(0, 60).map((r) => (
                    <li key={r.id} className="grid grid-cols-[32px_minmax(0,1fr)] items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[32px_minmax(120px,1fr)_minmax(160px,1.6fr)_auto_minmax(110px,auto)] sm:px-5">
                      <span className="grid size-8 place-items-center rounded-full bg-brand-50 text-xs font-bold text-brand-800" aria-hidden>
                        {initials(r.name)}
                      </span>
                      <span className="min-w-0 truncate font-medium text-brand-950">{shortName(r.name)}</span>
                      <span className="col-start-2 min-w-0 truncate text-brand-900/70 sm:col-start-auto">{r.reason}</span>
                      <span className="col-start-2 sm:col-start-auto">
                        <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${STEP_TONE[r.kind]}`}>{r.step}</span>
                      </span>
                      <span className="col-start-2 text-xs text-brand-900/65 sm:col-start-auto sm:text-right">
                        {r.action?.href ? (
                          <Link href={r.action.href} className="font-semibold text-brand-700 hover:underline">
                            {r.action.label}
                          </Link>
                        ) : r.action && r.action.include !== undefined ? (
                          <form action={toggleRecipientAction} className="inline">
                            <input type="hidden" name="clinic_id" value={clinic.id} />
                            <input type="hidden" name="campaign_id" value={selected.id} />
                            <input type="hidden" name="id" value={r.id} />
                            <input type="hidden" name="include" value={String(r.action.include)} />
                            {r.when && <span className="mr-2">{r.when}</span>}
                            <button className="font-semibold text-brand-700 hover:underline">{r.action.label}</button>
                          </form>
                        ) : (
                          r.when
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="border-t border-brand-900/5 px-5 py-6 text-sm text-brand-900/65">
                  {filter === "fuera" ? "Nadie quedó afuera." : "No hay nadie esperando un mensaje en esta campaña."}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-brand-900/5 p-4 sm:px-5">
                <span className="text-sm text-brand-900/70">
                  <b className="text-brand-950">{plural(queue.counts.cola, "en cola", "en cola")}</b>
                  {queue.counts.fuera > 0 && ` · ${queue.counts.fuera} fuera de la cola por los motivos de la lista`}
                </span>
                <span className="flex flex-wrap gap-2">
                  <Link href={`/panel/campanas/${selected.id}`} className={secondaryButtonClass}>
                    Ver la lista
                  </Link>
                  {queue.counts.cola > 0 && (
                    <Link href={`/panel/campanas/${selected.id}/lote`} className={buttonClass}>
                      Revisar lote de {Math.min(queue.counts.cola, LOT_SIZE)}
                    </Link>
                  )}
                </span>
              </div>
            </Card>
          </div>

          <aside aria-labelledby="ajustes-campana" className="min-w-0">
            <Card>
              <div className="mb-3 flex items-start justify-between gap-2">
                <h2 id="ajustes-campana" className="min-w-0 truncate font-semibold text-brand-950">{selected.name}</h2>
                <Badge tone={ACTIVE_STATUS[selected.status].tone}>{ACTIVE_STATUS[selected.status].label}</Badge>
              </div>
              <CampaignSettings
                key={selected.id}
                clinicId={clinic.id}
                campaignId={selected.id}
                rule={
                  selected.type === "personalizada"
                    ? "Aviso a todos los pacientes que no pidieron la baja."
                    : selected.type === "audiencia" && parseRules(selected.audience_rules)
                      ? describeRules(parseRules(selected.audience_rules)!, { type: sample.detail })
                      : campaignRule(selected.type, clinic)
                }
                breakdown={breakdown}
                cooldownDays={clinic.contact_cooldown_days}
                delayDays={followupStep?.delay_days ?? DEFAULT_FOLLOWUP_DAYS}
                maxMessages={followupStep ? selected.max_messages : 1}
                stopOnReply={selected.stop_on_reply}
                stopOnBooking={selected.stop_on_booking}
                sequencesEnabled={clinic.sequences_enabled}
                message={selected.message?.trim() || campaignMessage({ type: selected.type, message: null }, "{nombre}", "{detalle}")}
                followup={followupStep?.message?.trim() || DEFAULT_FOLLOWUP_TEXT}
                goal={selected.goal ?? CAMPAIGN_LABELS[selected.type].goal}
                sample={sample}
                optOutFooter={OPT_OUT_FOOTER}
                listHref={`/panel/campanas/${selected.id}`}
                pilot={selected.pilot_size !== null}
                pilotSize={PILOT_SIZE}
              />
            </Card>
          </aside>
        </div>
      ) : null}

      {finished.length > 0 && (
        <section aria-labelledby="historial" className="mt-10">
          <h2 id="historial" className="mb-3 font-semibold text-brand-950">Historial</h2>
          <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
            {finished.map((c) => {
              const s = stats.get(c.id) ?? EMPTY_STATS;
              return (
                <li key={c.id}>
                  <Link href={`/panel/campanas?campana=${c.id}#campana`} className="block rounded-2xl border border-brand-900/10 bg-white p-4 transition hover:border-brand-300">
                    <span className="flex items-start justify-between gap-2">
                      <span className="min-w-0">
                        <span className="block text-xs text-brand-900/65">
                          {CAMPAIGN_LABELS[c.type].label} · {formatDate(c.sent_at ?? c.created_at, clinic.timezone)}
                        </span>
                        <b className="block truncate text-brand-950">{c.name}</b>
                      </span>
                      <span className="flex shrink-0 gap-1.5">
                        {c.automatic && <Badge tone="blue">Automática</Badge>}
                        <Badge tone={CAMPAIGN_STATUS[c.status].tone}>{CAMPAIGN_STATUS[c.status].label}</Badge>
                      </span>
                    </span>
                    <span className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-brand-900/70">
                      <span>{plural(s.sent, "contactado", "contactados")}</span>
                      <span>{plural(s.replied, "respondió", "respondieron")}</span>
                      <span className="font-medium text-emerald-700">{plural(s.booked, "sacó turno", "sacaron turno")}</span>
                      {s.attended > 0 && <span>{plural(s.attended, "vino", "vinieron")}</span>}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      <section aria-labelledby="otras" className="mt-10 grid grid-cols-1 gap-6 lg:grid-cols-2 [&>*]:min-w-0">
        <h2 id="otras" className="sr-only">Mandar a mano y avisos</h2>
        <Card>
          <h3 className="font-semibold text-brand-950">Mandar a mano</h3>
          <p className="mt-1 text-sm text-brand-900/65">
            Mientras las automáticas estén apagadas, estas listas se revisan y se mandan desde acá. A quien ya le llegó el recordatorio o la encuesta no le
            llega otra.
          </p>
          <ul className="mt-3 divide-y divide-brand-900/5 text-sm">
            {(["recordatorio", "encuesta"] as const).map((type) => {
              const o = byType.get(type)!;
              return (
                <li key={type} className="flex items-center justify-between gap-3 py-2">
                  <span>
                    {CAMPAIGN_LABELS[type].title} · <b className="tabular-nums">{o.members.length}</b>
                  </span>
                  {o.open ? (
                    <Link href={`/panel/campanas/${o.open.id}`} className="font-semibold text-brand-700 hover:underline">
                      Seguir
                    </Link>
                  ) : (
                    <form action={prepareCampaignAction}>
                      <input type="hidden" name="clinic_id" value={clinic.id} />
                      <input type="hidden" name="type" value={type} />
                      <button disabled={!o.members.length} className="font-semibold text-brand-700 hover:underline disabled:text-brand-900/40 disabled:no-underline">
                        Revisar y enviar
                      </button>
                    </form>
                  )}
                </li>
              );
            })}
          </ul>
        </Card>
        <Card>
          <details>
            <summary className="cursor-pointer font-semibold text-brand-950">Aviso a todos los pacientes</summary>
            <p className="mt-1 text-sm text-brand-900/65">Para un cambio de horario, vacaciones o una novedad. Le llega a todos los que no pidieron la baja.</p>
            <form action={prepareCampaignAction} className="mt-4 space-y-3">
              <input type="hidden" name="clinic_id" value={clinic.id} />
              <input type="hidden" name="type" value="personalizada" />
              <Field label="Nombre de la campaña">
                <input name="name" placeholder="Ej. Vacaciones de enero" className={inputClass} />
              </Field>
              <Field label="Qué tiene que contar Sofi si responden" hint="El mensaje lo podés escribir en el paso siguiente.">
                <textarea name="goal" rows={3} placeholder="Del 2 al 16 de enero el consultorio está cerrado; las urgencias, a la guardia del Hospital…" className={inputClass} />
              </Field>
              {clinic.whatsapp_provider === "meta" && (
                <Field label="Template aprobado por Meta" hint="Solo para que lo envíe Sofi por el WhatsApp oficial.">
                  <input name="template_name" placeholder="aviso_general" className={inputClass} />
                </Field>
              )}
              <button className={buttonClass}>Armar el aviso</button>
            </form>
          </details>
        </Card>
      </section>

        <section aria-labelledby="ajustes" id="ajustes-campanas" className="mt-10">
          <h2 id="ajustes" className="mb-3 font-semibold text-brand-950">Ajustes de las campañas</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3 [&>*]:min-w-0">
          <Card id="controles">
            <h2 className="font-semibold text-brand-950">Controles periódicos</h2>
            <p className="mt-1 text-sm text-brand-900/65">
              Cada cuánto vuelve un paciente por cada prestación. Cuando se le vence, aparece en «Controles vencidos». Es el mismo dato que se ve en
              Configuración → Prestaciones: cambialo acá o allá. Los controles puntuales se cargan en la ficha de cada paciente.
            </p>
            {types.length ? (
              <ul className="mt-4 divide-y divide-brand-900/5">
                {types.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                    <div className="min-w-0 pt-1">
                      <p className="truncate text-sm font-medium text-brand-950">{t.name}</p>
                      <p className="text-xs text-brand-900/60">
                        {t.specialty}
                        {dueByType.get(t.id) ? <span className="font-medium text-brand-700"> · {dueByType.get(t.id)} vencidos</span> : null}
                      </p>
                    </div>
                    <RecallSelect clinicId={clinic.id} typeId={t.id} name={t.name} value={t.recall_months} />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-3 text-sm text-brand-900/65">
                Primero cargá las prestaciones en{" "}
                <Link href="/panel/configuracion/prestaciones" className="text-brand-700 underline">
                  Configuración
                </Link>
                .
              </p>
            )}
          </Card>

          <Card>
            <h2 className="mb-3 font-semibold text-brand-950">Reglas de contacto</h2>
            <ContactRules clinicId={clinic.id} reactivation={clinic.reactivation_months} cooldown={clinic.contact_cooldown_days} />
            <p className="mt-3 border-t border-brand-900/5 pt-3 text-xs text-brand-900/65">
              Nunca le escribimos a quien pidió la baja ni a quien ya tiene un turno. {campaignRule("reactivacion", clinic)}
            </p>
          </Card>

          <Card id="automaticas" className="bg-brand-50/60">
            <h2 className="font-semibold text-brand-950">Automáticas</h2>
            <p className="mt-1 text-sm text-brand-900/70">
              {autoOn.size
                ? "Las prendidas salen solas por el WhatsApp conectado a Sofi y cada corrida queda en la lista de campañas. Si una corrida llega al tope, la siguiente sigue por los que quedaron."
                : "Están todas apagadas: no sale ningún mensaje solo. Se prenden de a una, cuando el consultorio valide el canal, a quiénes les llega y cómo se piden la baja."}
            </p>
            {!isAdmin && <p className="mt-2 text-xs text-brand-900/65">Las prende el equipo de Turnia, a pedido del consultorio.</p>}
            {clinic.is_demo && <p className="mt-2 text-xs text-brand-900/65">Es un perfil de demo: aunque estén prendidas, Sofi no le escribe a nadie.</p>}
            <ul className="mt-3 space-y-2 text-sm">
              {AUTOMATIC.map(([type, when]) => {
                const on = autoOn.has(type);
                return (
                  <li key={type} className="flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="block text-brand-950">{CAMPAIGN_LABELS[type].label}</span>
                      <span className="block text-xs text-brand-900/60">{when}</span>
                    </span>
                    {isAdmin ? (
                      <AutoToggle clinicId={clinic.id} type={type} label={CAMPAIGN_LABELS[type].label} on={on} />
                    ) : (
                      <Badge tone={on ? "green" : "gray"}>{on ? "Prendida" : "Apagada"}</Badge>
                    )}
                  </li>
                );
              })}
              <li className="flex items-center justify-between gap-3 border-t border-brand-900/5 pt-2">
                <span className="min-w-0">
                  <span className="block text-brand-950">Seguimiento a quien no responde</span>
                  <span className="block text-xs text-brand-900/60">
                    A los {DEFAULT_FOLLOWUP_DAYS} días, hasta {DEFAULT_MAX_MESSAGES} mensajes. Se corta si responde, saca turno o pide la baja.
                  </span>
                </span>
                {isAdmin ? (
                  <AutoToggle clinicId={clinic.id} label="Seguimiento a quien no responde" on={clinic.sequences_enabled} />
                ) : (
                  <Badge tone={clinic.sequences_enabled ? "green" : "gray"}>{clinic.sequences_enabled ? "Prendido" : "Apagado"}</Badge>
                )}
              </li>
              <li className="flex items-center justify-between gap-3 border-t border-brand-900/5 pt-2">
                <span className="min-w-0">
                  <span className="block text-brand-950">{CAMPAIGN_LABELS.lista_espera.label}</span>
                  <span className="block text-xs text-brand-900/60">Avisa sola cuando se libera un turno</span>
                </span>
                <Badge tone="blue">Automática</Badge>
              </li>
            </ul>
            <p className="mt-3 text-xs text-brand-900/65">
              Lo que sale solo (salvo recordatorios y encuesta) sale de lunes a viernes, de {SEND_WINDOW.from} a {SEND_WINDOW.to}, y como mucho{" "}
              {DAILY_LINE_CAP} mensajes por día desde el WhatsApp del consultorio.
            </p>
          </Card>
          </div>
        </section>
    </>
  );
}
