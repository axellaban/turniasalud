import { getPanelClinic } from "@/lib/panel-clinic";
import Link from "next/link";
import { sql } from "@/lib/db";
import { getCatalog, getScheduleBlocks } from "@/lib/clinic";
import { googleBusy } from "@/lib/calendar/sync";
import { bookedMinutes, visibleHours, type Span } from "@/lib/agenda-layout";
import { addDaysKey, localDateKey, parseDateKey, timeToMinutes, weekdayOfKey, zonedParts, zonedTimeToUtc } from "@/lib/time";
import { displayPhone } from "@/lib/phone";
import { CHANNEL_LABEL, Empty, PageHeader, StatusBadge, ghostButtonClass, secondaryButtonClass } from "@/components/ui";
import { AppointmentActions, MarkAttended } from "./appointment-actions";
import { CalendarGrid, ColumnHeading, PRO_COLORS, clock, type GridColumn, type GridEvent } from "./calendar-grid";
import { ManualAppointmentForm } from "./manual-form";
import { ManualPanel } from "./manual-panel";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Agenda · Panel" };

type Row = {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  source: string;
  coverage: string | null;
  notes: string | null;
  confirmed_at: string | null;
  reminder_sent_at: string | null;
  calendar_sync: string | null;
  professional_id: string;
  second_professional_id: string | null;
  appointment_type_id: string;
  patient: string | null;
  phone: string;
  type_name: string;
};

const VISIBLE = ["confirmado", "pendiente", "atendido", "ausente"];
const one = (v: string | string[] | undefined) => (typeof v === "string" ? v : undefined);
/** ¿Atiende este turno? También como segundo profesional (por ejemplo, una cirugía conjunta). */
const attends = (r: Row, ids: string[]) => ids.includes(r.professional_id) || (r.second_professional_id !== null && ids.includes(r.second_professional_id));

export default async function AgendaPage({ searchParams }: PageProps<"/panel/agenda">) {
  const clinic = await getPanelClinic();
  const tz = clinic.timezone;
  const params = await searchParams;
  const todayKey = localDateKey(new Date(), tz);
  const dayKey = parseDateKey(one(params.fecha)) ?? todayKey;
  const view = one(params.vista) === "dia" ? "dia" : "semana";
  const catalog = await getCatalog(clinic.id);
  const proFilter = catalog.professionals.find((p) => p.id === one(params.pro))?.id ?? null;
  const shownPros = proFilter ? catalog.professionals.filter((p) => p.id === proFilter) : catalog.professionals;
  const shownIds = shownPros.map((p) => p.id);
  const colorOf = new Map(catalog.professionals.map((p, i) => [p.id, i]));
  const proName = new Map(catalog.professionals.map((p) => [p.id, p.full_name]));
  const prosOf = (r: Row) => [r.professional_id, r.second_professional_id].flatMap((id) => (id ? [proName.get(id) ?? "Profesional"] : [])).join(" y ");

  // Semana (de lunes a domingo) que contiene el día elegido.
  const weekStartKey = addDaysKey(dayKey, -((weekdayOfKey(dayKey) + 6) % 7));
  const week = Array.from({ length: 7 }, (_, i) => addDaysKey(weekStartKey, i));
  const utc = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return zonedTimeToUtc(y, m, d, 0, 0, tz);
  };
  const from = utc(weekStartKey);
  const to = utc(addDaysKey(weekStartKey, 7));

  const [rows, blocks, google] = await Promise.all([
    sql<Row[]>`
      select a.id, a.starts_at, a.ends_at, a.status, a.source, a.coverage, a.notes, a.confirmed_at, a.reminder_sent_at,
             a.calendar_sync, a.professional_id, a.second_professional_id, a.appointment_type_id, p.full_name as patient, p.phone, t.name as type_name
      from appointments a
      join patients p on p.id = a.patient_id
      join appointment_types t on t.id = a.appointment_type_id
      where a.clinic_id = ${clinic.id}
        and a.starts_at >= ${from} and a.starts_at < ${to}
        and a.status <> 'reprogramado'
      order by a.starts_at`,
    getScheduleBlocks(clinic.id, from, to),
    // Lo ocupado en Google Calendar (si está conectado). Si Google falla, la agenda se ve igual.
    googleBusy(clinic.id, shownIds, from, to, { timeZone: tz }).catch(() => []),
  ]);

  // Todo pasado a minutos del día local, por día.
  const local = (iso: string | Date) => {
    const p = zonedParts(new Date(iso), tz);
    return { key: `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`, minute: p.hour * 60 + p.minute };
  };
  const spanOn = (key: string, startIso: string, endIso: string): Span | null => {
    const s = local(startIso);
    const e = local(endIso);
    if (s.key > key || e.key < key) return null;
    const span = { start: s.key < key ? 0 : s.minute, end: e.key > key ? 24 * 60 : e.minute };
    return span.end > span.start ? span : null;
  };
  const openFor = (key: string, proIds: string[]) =>
    catalog.schedules
      .filter((s) => proIds.includes(s.professional_id) && s.weekday === weekdayOfKey(key))
      .map((s) => ({ start: timeToMinutes(s.start_time), end: timeToMinutes(s.end_time) }));
  const blocksFor = (key: string, proIds: string[]) =>
    blocks.flatMap((b) => {
      const applies = !b.professional_id || proIds.includes(b.professional_id);
      const span = applies ? spanOn(key, b.starts_at, b.ends_at) : null;
      if (!span) return [];
      // Con varios profesionales en la columna, un bloqueo de uno solo dice de quién es.
      const who = b.professional_id && proIds.length > 1 ? `${proName.get(b.professional_id)}: ` : "";
      return [{ ...span, label: `${who}${b.reason || "Agenda bloqueada"}` }];
    });
  const googleFor = (key: string, proIds: string[]) =>
    proIds.length === 1 ? google.filter((g) => g.professional_id === proIds[0]).flatMap((g) => spanOn(key, g.starts_at, g.ends_at) ?? []) : [];

  const visible = rows.filter((r) => VISIBLE.includes(r.status) && attends(r, shownIds));
  const selectedId = one(params.turno);
  const selected = rows.find((r) => r.id === selectedId) ?? null;
  const nowAt = new Date();
  const now = zonedParts(nowAt, tz);
  const nowMinute = now.hour * 60 + now.minute;
  // Turnos que ya terminaron y nadie marcó: sin la marca no hay encuestas, recall ni seguimiento de ausentes.
  const unmarked = visible.filter((r) => (r.status === "confirmado" || r.status === "pendiente") && new Date(r.ends_at) <= nowAt);
  const unmarkedIds = new Set(unmarked.map((r) => r.id));
  const cancelled = rows.filter((r) => r.status === "cancelado" && attends(r, shownIds));

  const href = (next: Record<string, string | null | undefined>) => {
    const q = new URLSearchParams();
    const merged = { fecha: dayKey, vista: view === "dia" ? "dia" : null, pro: proFilter, ...next };
    for (const [k, v] of Object.entries(merged)) if (v) q.set(k, v);
    return `/panel/agenda${q.size ? `?${q}` : ""}`;
  };
  const dayName = (key: string, style: "short" | "long" = "short") =>
    new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: style }).format(new Date(`${key}T12:00:00Z`)).replace(".", "");
  const dayNum = (key: string) => Number(key.slice(8));
  const statsFor = (key: string, proIds: string[]) => {
    let available = 0;
    let booked = 0;
    const opens = proIds.some((id) => openFor(key, [id]).length);
    for (const id of proIds) {
      const m = bookedMinutes(
        openFor(key, [id]),
        blocksFor(key, [id]),
        visible.filter((r) => attends(r, [id])).flatMap((r) => spanOn(key, r.starts_at, r.ends_at) ?? []),
      );
      available += m.available;
      booked += m.booked;
    }
    const count = visible.filter((r) => attends(r, proIds) && local(r.starts_at).key === key).length;
    return { count, ratio: available ? Math.min(1, booked / available) : null, blocked: opens && !available };
  };

  const column = (key: string, proIds: string[], heading: GridColumn["heading"]): GridColumn => ({
    key: `${key}-${proIds.join(",")}`,
    heading,
    open: openFor(key, proIds),
    blocks: blocksFor(key, proIds),
    google: googleFor(key, proIds),
    now: key === todayKey ? nowMinute : null,
    bookableFrom: key < todayKey ? null : key === todayKey ? nowMinute : 0,
    slotHref: (m) => href({ fecha: key, nuevo: "1", hora: clock(m), profesional: proIds.length === 1 ? proIds[0] : null, turno: null }),
    slotLabel: (time) => `Agregar turno el ${dayName(key, "long")} ${dayNum(key)} a las ${time}`,
  });

  // Semana: una columna por día. Día: una por profesional (si son pocos) o una sola.
  const weekColumns = week.map((key) => {
    const st = statsFor(key, shownIds);
    return column(key, shownIds, (
      <ColumnHeading top={dayName(key)} main={dayNum(key)} highlight={key === todayKey} count={st.count} ratio={st.ratio} blocked={st.blocked}
        href={href({ fecha: key, vista: "dia", turno: null })} current={key === dayKey} />
    ));
  });
  const splitByPro = shownPros.length > 1 && shownPros.length <= 5;
  const dayColumns = splitByPro
    ? shownPros.map((p) => {
        const st = statsFor(dayKey, [p.id]);
        return column(dayKey, [p.id], (
          <ColumnHeading top={<><span className={`mr-1 inline-block h-2 w-2 rounded-full ${PRO_COLORS[colorOf.get(p.id)! % PRO_COLORS.length].dot}`} />{p.specialty}</>}
            main={<span className="truncate text-sm">{p.full_name}</span>} count={st.count} ratio={st.ratio} blocked={st.blocked} href={href({ pro: p.id, turno: null })} />
        ));
      })
    : (() => {
        const st = statsFor(dayKey, shownIds);
        return [column(dayKey, shownIds, <ColumnHeading top={dayName(dayKey, "long")} main={dayNum(dayKey)} highlight={dayKey === todayKey} count={st.count} ratio={st.ratio} blocked={st.blocked} />)];
      })();

  const eventsFor = (columns: GridColumn[], match: (r: Row, c: GridColumn, ci: number) => boolean): GridEvent[] =>
    visible.flatMap((r) => columns.flatMap((c, ci) => {
      // Un turno con dos profesionales va en la columna de cada uno.
      if (!match(r, c, ci)) return [];
      const s = local(r.starts_at);
      const e = local(r.ends_at);
      return [{
        id: r.id,
        column: ci,
        start: s.minute,
        end: e.key === s.key ? e.minute : 24 * 60,
        time: `${clock(s.minute)}–${clock(e.key === s.key ? e.minute : 24 * 60)}`,
        title: r.patient ?? "Paciente",
        detail: shownPros.length > 1 && !splitByPro ? `${r.type_name} · ${prosOf(r)}` : r.second_professional_id ? `${r.type_name} · ${prosOf(r)}` : r.type_name,
        status: r.status,
        color: colorOf.get(r.professional_id) ?? 0,
        href: href({ turno: r.id, nuevo: null, fecha: s.key }),
        selected: r.id === selectedId,
        unmarked: unmarkedIds.has(r.id),
      }];
    }));
  const weekEvents = eventsFor(weekColumns, (r, _c, i) => local(r.starts_at).key === week[i]);
  const dayEvents = eventsFor(dayColumns, (r, _c, i) => local(r.starts_at).key === dayKey && (!splitByPro || attends(r, [shownPros[i].id])));

  const hourSpans = [
    ...catalog.schedules.filter((s) => shownIds.includes(s.professional_id)).map((s) => ({ start: timeToMinutes(s.start_time), end: timeToMinutes(s.end_time) })),
    ...visible.flatMap((r) => { const s = local(r.starts_at); const e = local(r.ends_at); return e.key === s.key ? [{ start: s.minute, end: e.minute }] : []; }),
  ];
  const hours = visibleHours(hourSpans);

  const monthDay = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", day: "numeric", month: "short" });
  const at = (key: string) => new Date(`${key}T12:00:00Z`);
  const weekTitle = `${monthDay.format(at(week[0]))} – ${monthDay.format(at(week[6]))} ${week[6].slice(0, 4)}`.replace(/\./g, "");
  const dayTitle = new Intl.DateTimeFormat("es-AR", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" }).format(at(dayKey));
  const step = view === "dia" ? 1 : 7;
  const isNow = view === "dia" ? dayKey === todayKey : week.includes(todayKey);

  const wantsNew = one(params.nuevo) === "1";
  const newTime = one(params.hora);
  const newPro = one(params.profesional);

  return (
    <>
      <PageHeader
        title="Agenda"
        description="Los turnos que da el agente aparecen acá al instante. Tocá un hueco libre para dar un turno."
        actions={
          <div className="flex items-center gap-2">
            <div className="hidden rounded-full bg-brand-900/5 p-0.5 md:flex" role="group" aria-label="Vista">
              {(["semana", "dia"] as const).map((v) => (
                <Link key={v} href={href({ vista: v === "dia" ? "dia" : null, turno: null })} aria-current={view === v ? "page" : undefined}
                  className={`rounded-full px-3.5 py-1.5 text-sm font-medium ${view === v ? "bg-white text-brand-950 shadow-sm" : "text-brand-900/65 hover:text-brand-950"}`}>
                  {v === "dia" ? "Día" : "Semana"}
                </Link>
              ))}
            </div>
            {!isNow && <Link href={href({ fecha: todayKey, turno: null })} className={secondaryButtonClass}>Hoy</Link>}
          </div>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex items-center">
          <Link href={href({ fecha: addDaysKey(dayKey, -step), turno: null })} className={`${ghostButtonClass} px-2.5 text-lg`} aria-label={view === "dia" ? "Día anterior" : "Semana anterior"}>‹</Link>
          <Link href={href({ fecha: addDaysKey(dayKey, step), turno: null })} className={`${ghostButtonClass} px-2.5 text-lg`} aria-label={view === "dia" ? "Día siguiente" : "Semana siguiente"}>›</Link>
        </div>
        <h2 className="text-lg font-semibold text-brand-950 first-letter:uppercase">
          <span className={view === "dia" ? "" : "md:hidden"}>{dayTitle}{dayKey === todayKey ? " · hoy" : ""}</span>
          {view === "semana" && <span className="hidden md:inline">{weekTitle}</span>}
        </h2>
        {catalog.professionals.length > 1 && (
          <nav aria-label="Profesionales" className="flex flex-wrap gap-1.5 md:ml-auto">
            <Link href={href({ pro: null, turno: null })} aria-current={!proFilter ? "page" : undefined}
              className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${!proFilter ? "bg-brand-950 text-white ring-brand-950" : "bg-white text-brand-900 ring-brand-900/15 hover:ring-brand-300"}`}>
              Todos
            </Link>
            {catalog.professionals.map((p) => (
              <Link key={p.id} href={href({ pro: p.id, turno: null })} aria-current={proFilter === p.id ? "page" : undefined}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ring-1 ${proFilter === p.id ? "bg-brand-950 text-white ring-brand-950" : "bg-white text-brand-900 ring-brand-900/15 hover:ring-brand-300"}`}>
                <span className={`h-2 w-2 rounded-full ${PRO_COLORS[colorOf.get(p.id)! % PRO_COLORS.length].dot}`} />
                {p.full_name}
              </Link>
            ))}
          </nav>
        )}
      </div>

      {/* En el celular siempre se ve un día, con la semana para elegirlo. */}
      <nav aria-label="Días de la semana" className={`mb-3 grid grid-cols-7 gap-1 ${view === "semana" ? "md:hidden" : ""}`}>
        {week.map((key) => {
          const st = statsFor(key, shownIds);
          const current = key === dayKey;
          return (
            <Link key={key} href={href({ fecha: key, turno: null })} scroll={false} aria-current={current ? "date" : undefined}
              className={`flex flex-col items-center rounded-xl py-1.5 text-center ${current ? "bg-brand-600 text-white" : "bg-white ring-1 ring-brand-900/10"}`}>
              <span className={`text-[10px] font-medium uppercase ${current ? "text-white/85" : "text-brand-900/60"}`}>{dayName(key)}</span>
              <span className={`text-base font-semibold leading-tight ${!current && key === todayKey ? "text-brand-600" : ""}`}>{dayNum(key)}</span>
              <span className={`mt-0.5 h-1 w-6 overflow-hidden rounded-full ${current ? "bg-white/30" : "bg-brand-900/10"}`}>
                {st.ratio !== null && <span className={`block h-full ${current ? "bg-white" : "bg-brand-500"}`} style={{ width: `${Math.round(st.ratio * 100)}%` }} />}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0 space-y-3">
          {unmarked.length > 0 && (
            <MarkAttended clinicId={clinic.id} ids={unmarked.map((r) => r.id)} />
          )}
          {!catalog.professionals.length ? (
            <Empty>Cargá profesionales en Configuración → Equipo y horarios para empezar.</Empty>
          ) : (
            <>
              {view === "semana" && (
                <div className="hidden md:block">
                  <CalendarGrid columns={weekColumns} events={weekEvents} hours={hours} minWidth={720} />
                </div>
              )}
              <div className={view === "semana" ? "md:hidden" : ""}>
                <CalendarGrid columns={dayColumns} events={dayEvents} hours={hours} minWidth={splitByPro ? dayColumns.length * 140 : undefined} />
              </div>
              <Legend google={google.length > 0} />
              {cancelled.length > 0 && (
                <details className="rounded-2xl bg-white px-4 py-3 text-sm ring-1 ring-brand-900/10">
                  <summary className="cursor-pointer font-medium text-brand-900">
                    {cancelled.length === 1 ? "1 turno cancelado" : `${cancelled.length} turnos cancelados`} esta semana
                  </summary>
                  <ul className="mt-2 divide-y divide-brand-900/5">
                    {cancelled.map((r) => (
                      <li key={r.id}>
                        <Link href={href({ turno: r.id, fecha: local(r.starts_at).key })} scroll={false} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 py-2 hover:text-brand-700">
                          <span className="w-28 shrink-0 tabular-nums text-brand-900/60 first-letter:uppercase">{dayName(local(r.starts_at).key)} {dayNum(local(r.starts_at).key)} · {clock(local(r.starts_at).minute)}</span>
                          <span className="font-medium text-brand-950 line-through decoration-brand-900/30">{r.patient ?? "Paciente"}</span>
                          <span className="text-xs text-brand-900/60">{r.type_name} · {prosOf(r)}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </>
          )}
        </div>

        <div className="h-fit space-y-4 xl:sticky xl:top-20">
          {selected && (
            <AppointmentDetail
              key={selected.id}
              row={selected}
              pro={prosOf(selected)}
              tz={tz}
              closeHref={href({ turno: null })}
              clinicId={clinic.id}
              today={todayKey}
              dayKey={local(selected.starts_at).key}
              colleagues={catalog.professionals
                .filter((p) => p.specialty === catalog.professionals.find((x) => x.id === selected.professional_id)?.specialty && p.id !== selected.second_professional_id)
                .map((p) => ({ id: p.id, name: p.full_name }))}
            />
          )}
          <ManualPanel defaultOpen={wantsNew} key={`${wantsNew}|${dayKey}|${newTime}|${newPro}`}>
            <ManualAppointmentForm
              clinicId={clinic.id}
              defaultDate={dayKey}
              today={todayKey}
              initialProId={wantsNew ? (newPro ?? proFilter ?? undefined) : undefined}
              initialTime={wantsNew ? newTime : undefined}
              professionals={catalog.professionals.map((p) => ({ id: p.id, name: p.full_name, specialty: p.specialty }))}
              types={catalog.appointmentTypes.map((t) => ({ id: t.id, name: t.name, specialty: t.specialty }))}
            />
          </ManualPanel>
        </div>
      </div>
    </>
  );
}

function Legend({ google }: { google: boolean }) {
  const item = (swatch: string, label: string) => (
    <span className="inline-flex items-center gap-1.5"><span className={`h-3 w-4 rounded-sm ${swatch}`} />{label}</span>
  );
  return (
    <p className="flex flex-wrap gap-x-4 gap-y-1.5 text-[11px] text-brand-900/65">
      {item("border-l-[3px] border-brand-500 bg-brand-100", "Confirmado")}
      {item("border border-dashed border-brand-500 bg-white", "Pendiente")}
      {item("border-l-[3px] border-brand-500 bg-brand-100 opacity-60", "Atendido")}
      {item("border-l-[3px] border-red-400 bg-red-50", "Ausente")}
      {item("bg-[repeating-linear-gradient(135deg,rgba(255,201,122,0.5)_0_3px,rgba(255,241,220,0.8)_3px_6px)]", "Feriado o bloqueo")}
      {google && item("bg-[repeating-linear-gradient(135deg,rgba(8,24,63,0.12)_0_3px,rgba(8,24,63,0.03)_3px_6px)] ring-1 ring-brand-900/10", "Ocupado en Google")}
      {item("bg-brand-900/[0.06]", "Fuera de horario")}
    </p>
  );
}

function AppointmentDetail({ row: a, pro, tz, closeHref, clinicId, today, dayKey, colleagues }: {
  row: Row;
  pro: string;
  tz: string;
  closeHref: string;
  clinicId: string;
  today: string;
  dayKey: string;
  /** Profesionales que hacen esta prestación (para moverlo a otro). */
  colleagues: Array<{ id: string; name: string }>;
}) {
  const when = new Intl.DateTimeFormat("es-AR", { timeZone: tz, weekday: "long", day: "numeric", month: "long" }).format(new Date(a.starts_at));
  const time = (iso: string) => new Intl.DateTimeFormat("es-AR", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(iso));
  const wa = /^\d{8,15}$/.test(a.phone) ? `https://wa.me/${a.phone}` : null;
  const facts: Array<[string, string | null]> = [
    ["Prestación", a.type_name],
    [a.second_professional_id ? "Profesionales" : "Profesional", pro],
    ["Cobertura", a.coverage ?? "Sin cobertura"],
    ["Teléfono", displayPhone(a.phone)],
    ["Lo dio", CHANNEL_LABEL[a.source] ?? a.source],
    ["Nota", a.notes],
  ];
  return (
    <section aria-label="Turno elegido" className="rounded-2xl border border-brand-900/10 bg-white p-5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-brand-900/60 first-letter:uppercase">{when} · {time(a.starts_at)}–{time(a.ends_at)}</p>
          <h2 className="mt-1 truncate text-lg font-semibold text-brand-950">{a.patient ?? "Paciente"}</h2>
        </div>
        <Link href={closeHref} scroll={false} className={ghostButtonClass} aria-label="Cerrar el turno">✕</Link>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
        <StatusBadge value={a.status} />
        {a.confirmed_at ? <span className="font-medium text-brand-700">Confirmó asistencia</span> : a.reminder_sent_at ? <span className="text-brand-900/65">Recordatorio enviado</span> : null}
        {a.calendar_sync === "ok" && <span className="text-brand-900/65">En Google Calendar</span>}
        {(a.calendar_sync === "pendiente" || a.calendar_sync === "error") && <span className="text-amber-700">Pendiente en Google Calendar</span>}
      </div>
      <dl className="mt-4 space-y-1.5 text-sm">
        {facts.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-3">
            <dt className="w-24 shrink-0 text-brand-900/60">{k}</dt>
            <dd className="min-w-0 break-words text-brand-950">{v}</dd>
          </div>
        ))}
      </dl>
      {wa && <a href={wa} target="_blank" rel="noreferrer" className="mt-3 inline-flex text-sm font-medium text-brand-700 hover:underline">Escribirle por WhatsApp →</a>}
      <AppointmentActions
        clinicId={clinicId}
        today={today}
        professionals={colleagues}
        appt={{ id: a.id, status: a.status, startsAt: a.starts_at, endsAt: a.ends_at, dayKey, typeId: a.appointment_type_id, professionalId: a.professional_id, secondProfessionalId: a.second_professional_id }}
      />
    </section>
  );
}
