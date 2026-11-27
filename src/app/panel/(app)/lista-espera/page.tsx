import Link from "next/link";
import { Badge, Card, Empty, Field, inputClass, PageHeader, secondaryButtonClass } from "@/components/ui";
import { getPanelClinic } from "@/lib/panel-clinic";
import { readWaitlist } from "@/lib/waitlist";
import { getCatalog } from "@/lib/clinic";
import { CONSULTATION_CATEGORIES, CONSULTATION_LABELS, type ConsultationCategory } from '@/lib/consultation-reason';
import { formatDateTime, localDateKey } from "@/lib/time";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lista de espera · Panel" };

export default async function WaitlistPage({ searchParams }: PageProps<"/panel/lista-espera">) {
  const clinic = await getPanelClinic();
  const params = await searchParams;
  const catalog = await getCatalog(clinic.id);
  const justToday = params.hoy === "1";
  const reason = CONSULTATION_CATEGORIES.includes(params.motivo as ConsultationCategory) ? params.motivo as ConsultationCategory : undefined;
  const priority = params.prioridad === 'alta' || params.prioridad === 'normal' ? params.prioridad : undefined;
  const withBooking = params.turno === 'si' ? true : params.turno === 'no' ? false : undefined;
  const professional = catalog.professionals.some(p => p.id === params.profesional) ? params.profesional as string : undefined;
  const requestedPage = Number(params.pagina ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10000 ? requestedPage : 1;
  const result = await readWaitlist(clinic.id, { pagina: page, motivo: reason, prioridad: priority, con_turno: withBooking, profesional_id: professional,
    ...(justToday && { desde: localDateKey(new Date(), clinic.timezone) }) });
  const href = (p = 1, today = justToday) => `/panel/lista-espera?${new URLSearchParams({ pagina: String(p), hoy: today ? '1' : '',
    motivo: reason ?? '', prioridad: priority ?? '', turno: withBooking === undefined ? '' : withBooking ? 'si' : 'no', profesional: professional ?? '' })}`;
  return (
    <>
      <PageHeader title="Lista de espera" description="En una sola lista: pacientes que esperan un horario y primeras consultas destacadas para evaluar un adelanto. Las reservas actuales se conservan." />
      <Card className="mb-4">
        <form method="get" className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {justToday && <input type="hidden" name="hoy" value="1" />}
          <Field label="Turno"><select name="turno" defaultValue={withBooking === undefined ? '' : withBooking ? 'si' : 'no'} className={inputClass}>
            <option value="">Con turno y sin turno</option><option value="si">Con turno</option><option value="no">Sin turno</option>
          </select></Field>
          <Field label="Motivo"><select name="motivo" defaultValue={reason ?? ''} className={inputClass}>
            <option value="">Todos los motivos</option>{CONSULTATION_CATEGORIES.map(c => <option key={c} value={c}>{CONSULTATION_LABELS[c]}</option>)}
          </select></Field>
          <Field label="Prioridad"><select name="prioridad" defaultValue={priority ?? ''} className={inputClass}>
            <option value="">Todas</option><option value="alta">Alta</option><option value="normal">Normal</option>
          </select></Field>
          <Field label="Profesional"><select name="profesional" defaultValue={professional ?? ''} className={inputClass}>
            <option value="">Todos</option>{catalog.professionals.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select></Field>
          <button className={secondaryButtonClass}>Aplicar filtros</button>
        </form>
      </Card>
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href={href(1, false)} className={secondaryButtonClass} aria-current={!justToday ? "page" : undefined}>Todos los pendientes</Link>
        <Link href={href(1, true)} className={secondaryButtonClass} aria-current={justToday ? "page" : undefined}>Anotados hoy</Link>
        <a href={href(page)} className={secondaryButtonClass}>Actualizar</a>
        <span className="text-brand-900/65">{result.total} en la lista · Consultada {formatDateTime(result.actualizada_a, clinic.timezone)}</span>
      </div>
      <p className="mb-4 text-sm text-brand-900/65">«Pidió aviso»: aceptó que lo contacten si se libera un lugar. «Para evaluar adelanto»: aparece por su motivo de consulta, sin haber pedido avisos. La prioridad alta destaca primeras consultas de implantes, prótesis y blanqueamiento; no indica urgencia clínica. El equipo decide a quién contactar. Esta pantalla no envía mensajes ni cambia turnos.</p>
      {result.pacientes.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 text-brand-900/70"><tr>
              <th scope="col" className="px-4 py-3">Paciente</th><th scope="col" className="px-4 py-3">Estado</th>
              <th scope="col" className="px-4 py-3">Motivo</th><th scope="col" className="px-4 py-3">Prioridad</th>
              <th scope="col" className="px-4 py-3">Preferencias</th><th scope="col" className="px-4 py-3">Turno que conserva</th>
            </tr></thead>
            <tbody className="divide-y divide-brand-900/5">{result.pacientes.map((p) => (
              <tr key={p.espera_id}>
                <td className="px-4 py-3"><Link href={`/panel/pacientes/${p.paciente_id}`} className="font-semibold text-brand-700 hover:underline">{p.paciente}</Link><p>{p.celular}</p><p className="text-xs text-brand-900/60">{p.inscripcion_confirmada ? 'Anotado' : 'Detectado'}: {p.anotado}{p.anotado_hoy ? " · hoy" : ""}</p></td>
                <td className="px-4 py-3"><Badge>{p.con_turno ? 'Con turno' : 'Sin turno'}</Badge><p className="mt-1 text-xs">{p.inscripcion_confirmada ? p.estado === 'ofrecida' ? 'Ya se ofreció un horario' : 'Pidió aviso' : 'Para evaluar adelanto'}</p></td>
                <td className="max-w-xs px-4 py-3"><p className="whitespace-pre-wrap break-words">{p.motivo ?? 'Motivo sin registrar'}</p><p className="text-xs text-brand-900/60">{p.prestacion} · {p.profesional}</p>
                  {p.nota_smile_pendiente && <p className="mt-1 text-xs text-amber-800">Nota pendiente en Smile Connect; el turno está confirmado. El motivo está disponible aquí.{p.nota_smile_error && ' Recepción puede copiarlo si no se completa automáticamente.'}</p>}
                </td>
                <td className="px-4 py-3">{p.prioridad === 'alta' ? 'Alta' : 'Normal'}</td>
                <td className="max-w-xs px-4 py-3">{p.preferencias}</td>
                <td className="px-4 py-3">{p.turno_actual?.cuando ?? "Sin turno vinculado"}</td>
              </tr>
            ))}</tbody>
          </table>
        </Card>
      ) : <Empty>{page > 1 ? "No hay más pacientes en esta página." : "No hay pacientes en espera con este filtro."}</Empty>}
      <nav aria-label="Páginas de la lista de espera" className="mt-4 flex gap-3">
        {page > 1 && <Link href={href(page - 1)} className={secondaryButtonClass}>Anterior</Link>}
        {result.siguiente_pagina && <Link href={href(result.siguiente_pagina)} className={secondaryButtonClass}>Siguiente</Link>}
      </nav>
    </>
  );
}
