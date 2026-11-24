import { getPanelClinic, getPanelUser } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { CAMPAIGN_LABELS, campaignRule, campaignStats, EMPTY_STATS, opportunities, type Opportunity } from "@/lib/campaigns";
import { formatDate } from "@/lib/time";
import { ATTRIBUTION_DAYS, type AppointmentType, type AutoCampaignType, type Campaign } from "@/lib/types";
import { prepareCampaignAction } from "../../campaign-actions";
import { Badge, Card, Field, Notice, PageHeader, buttonClass, inputClass, secondaryButtonClass } from "@/components/ui";
import { AutoToggle } from "./auto-toggle";
import { DAILY_LINE_CAP, DEFAULT_FOLLOWUP_DAYS, DEFAULT_MAX_MESSAGES, SEND_WINDOW } from "@/lib/campaign-limits";
import { ContactRules } from "./contact-rules";
import { RecallSelect } from "./recall-select";
import { CAMPAIGN_STATUS, money, plural } from "./labels";
import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = { title: "Campañas · Panel" };

/** Color de cada oportunidad (borde superior y número). */
const ACCENT: Partial<Record<Campaign["type"], string>> = {
  recall: "before:bg-brand-500",
  reactivacion: "before:bg-lila",
  no_show: "before:bg-sun-500",
  lista_espera: "before:bg-aqua",
  recordatorio: "before:bg-emerald",
  encuesta: "before:bg-brand-200",
};

/** Lo que corre solo (lo dispara n8n) en las clínicas que lo tienen prendido. */
const AUTOMATIC: Array<[AutoCampaignType, string]> = [
  ["recordatorio", "Todos los días a las 10"],
  ["no_show", "Todos los días a las 18"],
  ["encuesta", "Todos los días a las 19"],
  ["recall", "Los lunes a las 11"],
  ["reactivacion", "El 1 de cada mes a las 11"],
];

function names(o: Opportunity): string {
  const first = o.members.slice(0, 3).map((m) => m.name?.split(" ").slice(0, 2).join(" ") || "Sin nombre");
  const rest = o.members.length - first.length;
  return rest > 0 ? `${first.join(", ")} y ${plural(rest, "más", "más")}` : first.join(", ").replace(/, ([^,]*)$/, " y $1");
}

function OpportunityCard({ o, clinicId, hint, compact = false }: { o: Opportunity; clinicId: string; hint?: ReactNode; compact?: boolean }) {
  const label = CAMPAIGN_LABELS[o.type];
  const count = o.members.length;
  return (
    <Card
      className={`relative flex flex-col overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-1 ${ACCENT[o.type] ?? ""} ${compact ? "" : "min-h-[15rem]"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold text-brand-950">{label.title}</h3>
        {o.open && <Badge tone={CAMPAIGN_STATUS[o.open.status].tone}>{CAMPAIGN_STATUS[o.open.status].label}</Badge>}
      </div>
      <p className="mt-1 text-xs text-brand-900/65">{o.type === "reactivacion" || o.type === "recall" ? campaignRuleShort(o.type) : label.description}</p>
      <p className="mt-4 flex items-baseline gap-1.5">
        <span className="font-display text-4xl text-brand-950 tabular-nums">{count.toLocaleString("es-AR")}</span>
        <span className="text-sm text-brand-900/65">{count === 1 ? "paciente" : "pacientes"}</span>
      </p>
      {o.value > 0 && (
        <p className="text-sm font-medium text-brand-800" title={o.priced < count ? `Suma los ${o.priced} que tienen una prestación con precio` : undefined}>
          ≈ {money.format(o.value)} <span className="font-normal text-brand-900/60">en turnos{o.priced < count ? "*" : ""}</span>
        </p>
      )}
      {o.value > 0 && o.priced < count && <p className="text-[11px] text-brand-900/55">*{plural(count - o.priced, "paciente sin precio de referencia", "pacientes sin precio de referencia")}</p>}
      {count > 0 && !compact && <p className="mt-2 line-clamp-2 text-xs text-brand-900/60">{names(o)}</p>}
      {o.unreachable > 0 && <p className="mt-1 text-xs text-sun-700">{plural(o.unreachable, "más sin celular válido", "más sin celular válido")}</p>}
      {hint && count === 0 && <div className="mt-2 text-xs text-brand-900/70">{hint}</div>}
      <div className="mt-auto pt-4">
        {o.open ? (
          <Link href={`/panel/campanas/${o.open.id}`} className={`${buttonClass} w-full`}>
            Seguir con la campaña
          </Link>
        ) : (
          <form action={prepareCampaignAction}>
            <input type="hidden" name="clinic_id" value={clinicId} />
            <input type="hidden" name="type" value={o.type} />
            <button disabled={count === 0} className={`${count ? buttonClass : secondaryButtonClass} w-full disabled:cursor-not-allowed disabled:opacity-60`}>
              {count ? "Revisar y enviar" : "Nadie por ahora"}
            </button>
          </form>
        )}
      </div>
    </Card>
  );
}

const campaignRuleShort = (type: "recall" | "reactivacion") =>
  type === "recall" ? "Según cada cuánto vuelve cada prestación y los controles indicados." : "No vienen hace tiempo y no tienen turno.";

export default async function CampaignsPage() {
  const [clinic, user] = await Promise.all([getPanelClinic(), getPanelUser()]);
  const isAdmin = user.role === "admin";
  const autoOn = new Set(clinic.auto_campaigns ?? []);
  const [opp, campaigns, [base], types, [lastImport]] = await Promise.all([
    opportunities(clinic),
    sql<Campaign[]>`select * from campaigns where clinic_id = ${clinic.id} order by created_at desc limit 30`,
    sql<Array<{ total: number; with_history: number; opted_out: number; upcoming: number }>>`
      select count(*)::int as total,
        count(*) filter (where p.contact_opt_out)::int as opted_out,
        count(*) filter (where p.next_control_at > current_date)::int as upcoming,
        count(*) filter (where exists (select 1 from appointments a where a.patient_id = p.id and a.status = 'atendido')
          or exists (select 1 from patient_visits v where v.patient_id = p.id))::int as with_history
      from patients p where p.clinic_id = ${clinic.id}`,
    sql<AppointmentType[]>`select * from appointment_types where clinic_id = ${clinic.id} and active order by specialty, name`,
    sql<Array<{ created_at: string }>>`select created_at from patient_imports where clinic_id = ${clinic.id} and undone_at is null order by created_at desc limit 1`,
  ]);
  const stats = await campaignStats(clinic.id, campaigns.map((c) => c.id));
  const byType = new Map(opp.list.map((o) => [o.type, o]));
  const recall = byType.get("recall")!;
  const dueByType = new Map<string, number>();
  for (const m of recall.members) if (m.appointment_type_id) dueByType.set(m.appointment_type_id, (dueByType.get(m.appointment_type_id) ?? 0) + 1);
  const withRecall = types.filter((t) => t.recall_months).length;
  const needsBase = base.total === 0 || base.with_history < base.total / 2;

  return (
    <>
      <PageHeader
        title="Campañas"
        description="Pacientes que ya te conocen y tienen algo pendiente. Elegí a quiénes escribirles, revisá la lista y mandalo desde tu WhatsApp o con Sofi."
        // Sin base todavía, el botón de importar va en el recuadro de abajo, con su explicación.
        actions={!needsBase && (
          <Link href="/panel/pacientes/importar" className={secondaryButtonClass}>
            Importar pacientes
          </Link>
        )}
      />
      {clinic.is_demo && (
        <Notice tone="info" className="mb-6">
          Es un perfil de demo: podés importar pacientes y armar campañas para ver la lista y el mensaje, pero Sofi no envía nada desde acá.
        </Notice>
      )}

      <section aria-labelledby="base-titulo" className="mb-8 grid gap-6 overflow-hidden rounded-2xl bg-brand-950 p-6 text-white sm:p-8 lg:grid-cols-[1.3fr_1fr]">
        <div>
          <p id="base-titulo" className="text-xs font-semibold uppercase tracking-wider text-brand-200">
            Tu base para volver a agendar
          </p>
          <p className="mt-3 flex flex-wrap items-baseline gap-x-3">
            <span className="font-display text-5xl tabular-nums sm:text-6xl">{opp.patients.toLocaleString("es-AR")}</span>
            <span className="text-lg text-brand-100">{opp.patients === 1 ? "paciente" : "pacientes"}</span>
          </p>
          <p className="mt-2 max-w-md text-sm text-brand-100/80">
            {opp.value > 0 ? (
              <>
                <strong className="font-semibold text-white">≈ {money.format(opp.value)}</strong> en turnos, con los precios de referencia de tus
                prestaciones. Cada paciente cuenta una vez, aunque esté en más de una lista de abajo.
              </>
            ) : (
              <>
                Con controles vencidos, inactivos, ausentes o en lista de espera, sin repetir pacientes.{" "}
                <Link href="/panel/configuracion/prestaciones" className="underline underline-offset-2 hover:text-white">
                  Cargá precios
                </Link>{" "}
                para ver cuánto vale.
              </>
            )}
          </p>
        </div>
        <div className="rounded-xl bg-white/5 p-4 ring-1 ring-white/10">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
            <div>
              <dt className="text-brand-200/80">En la base</dt>
              <dd className="font-display text-2xl tabular-nums">{base.total.toLocaleString("es-AR")}</dd>
            </div>
            <div>
              <dt className="text-brand-200/80">Con visitas conocidas</dt>
              <dd className="font-display text-2xl tabular-nums">{base.with_history.toLocaleString("es-AR")}</dd>
            </div>
            <div>
              <dt className="text-brand-200/80">Controles agendados</dt>
              <dd className="font-display text-2xl tabular-nums">{base.upcoming.toLocaleString("es-AR")}</dd>
            </div>
            <div>
              <dt className="text-brand-200/80">No quieren campañas</dt>
              <dd className="font-display text-2xl tabular-nums">{base.opted_out.toLocaleString("es-AR")}</dd>
            </div>
          </dl>
          <div className="mt-4 border-t border-white/10 pt-4 text-sm">
            {needsBase ? (
              <>
                <p className="text-brand-100/85">Traé tus pacientes de tu sistema o tu Excel: con la fecha de su última visita aparecen los que hay que llamar.</p>
                <Link href="/panel/pacientes/importar" className="mt-3 inline-flex rounded-full bg-white px-4 py-2 font-semibold text-brand-950 hover:bg-brand-50">
                  Importar pacientes
                </Link>
              </>
            ) : (
              <p className="text-brand-100/80">
                {lastImport ? `Última importación: ${formatDate(lastImport.created_at, clinic.timezone)}. ` : ""}
                <Link href="/panel/pacientes/importar" className="underline underline-offset-2 hover:text-white">
                  Sumar o actualizar pacientes
                </Link>
              </p>
            )}
          </div>
        </div>
      </section>

      <section aria-labelledby="oportunidades" className="mb-8">
        <h2 id="oportunidades" className="mb-3 font-semibold text-brand-950">Para volver a agendar</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <OpportunityCard
            o={recall}
            clinicId={clinic.id}
            hint={
              withRecall === 0 ? (
                <a href="#controles" className="font-medium text-brand-700 underline underline-offset-2">Definí cada cuánto vuelve cada prestación</a>
              ) : base.with_history === 0 ? (
                "Cuando haya visitas en la base, aparecen acá."
              ) : undefined
            }
          />
          <OpportunityCard
            o={byType.get("reactivacion")!}
            clinicId={clinic.id}
            hint={base.with_history === 0 ? <Link href="/panel/pacientes/importar" className="font-medium text-brand-700 underline underline-offset-2">Importá la base con sus visitas</Link> : undefined}
          />
          <OpportunityCard o={byType.get("no_show")!} clinicId={clinic.id} />
          <OpportunityCard o={byType.get("lista_espera")!} clinicId={clinic.id} />
        </div>
        <h2 className="mb-3 mt-6 font-semibold text-brand-950">Del día a día</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <OpportunityCard o={byType.get("recordatorio")!} clinicId={clinic.id} compact />
          <OpportunityCard o={byType.get("encuesta")!} clinicId={clinic.id} compact />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section aria-labelledby="historial" className="min-w-0 space-y-4">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <h2 id="historial" className="font-semibold text-brand-950">Campañas</h2>
            <p className="text-xs text-brand-900/65">Un turno cuenta si se sacó dentro de los {ATTRIBUTION_DAYS} días del mensaje.</p>
          </div>
          {campaigns.length ? (
            <ul className="space-y-3">
              {campaigns.map((c) => {
                const s = stats.get(c.id) ?? EMPTY_STATS;
                const status = CAMPAIGN_STATUS[c.status];
                const toSend = s.pending + s.errors;
                return (
                  <li key={c.id}>
                    <Link href={`/panel/campanas/${c.id}`} className="block rounded-2xl border border-brand-900/10 bg-white p-4 transition hover:border-brand-300 sm:p-5">
                      <div className="flex flex-wrap items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs text-brand-900/65">
                            {CAMPAIGN_LABELS[c.type].label} · {formatDate(c.sent_at ?? c.created_at, clinic.timezone)}
                          </p>
                          <p className="truncate font-semibold text-brand-950">{c.name}</p>
                        </div>
                        <span className="flex gap-1.5">
                          {c.automatic && <Badge tone="blue">Automática</Badge>}
                          <Badge tone={status.tone}>{status.label}</Badge>
                        </span>
                      </div>
                      {s.sent > 0 ? (
                        <>
                          <div className="mt-3 flex h-1.5 overflow-hidden rounded-full bg-brand-50" aria-hidden>
                            <span className="bg-emerald" style={{ width: `${(s.booked / s.sent) * 100}%` }} />
                            <span className="bg-brand-300" style={{ width: `${((s.replied - s.booked) / s.sent) * 100}%` }} />
                          </div>
                          <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-brand-900/70">
                            <span>{plural(s.sent, "enviado", "enviados")}</span>
                            <span>{plural(s.replied, "respondió", "respondieron")}</span>
                            <span className="font-medium text-emerald-700">{plural(s.booked, "sacó turno", "sacaron turno")}</span>
                            {s.value > 0 && <span>≈ {money.format(s.value)}</span>}
                            {toSend > 0 && <span className="text-sun-700">{toSend} por enviar</span>}
                          </p>
                        </>
                      ) : (
                        <p className="mt-2 text-sm text-brand-900/70">{toSend ? `${plural(toSend, "paciente", "pacientes")} para revisar y enviar` : "Sin pacientes en la lista"}</p>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="rounded-2xl border border-dashed border-brand-900/15 p-6 text-sm text-brand-900/65">
              Todavía no hay campañas. Elegí una de las listas de arriba: vas a poder revisar a quiénes les llega y el mensaje antes de enviar.
            </p>
          )}

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

        {/* Lo de arriba es el trabajo del día; acá, los ajustes que cambian a quiénes aparecen. */}
        <aside aria-labelledby="ajustes" className="min-w-0 space-y-6">
          <h2 id="ajustes" className="font-semibold text-brand-950">Ajustes de las campañas</h2>
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

          <Card className="bg-brand-50/60">
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
            <p className="mt-2 text-xs text-brand-900/65">
              «Turnos de mañana» y «Atendidos estos días» se pueden mandar a mano mientras estén apagadas: a quien ya le llegó el recordatorio o la
              encuesta (a mano o automática) no le llega otra.
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
