import Link from "next/link";
import { Card, Empty, PageHeader, secondaryButtonClass } from "@/components/ui";
import { getPanelClinic } from "@/lib/panel-clinic";
import { readWaitlist } from "@/lib/waitlist";
import { formatDateTime, localDateKey } from "@/lib/time";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "Lista de espera · Panel" };

export default async function WaitlistPage({ searchParams }: PageProps<"/panel/lista-espera">) {
  const clinic = await getPanelClinic();
  const params = await searchParams;
  const justToday = params.hoy === "1";
  const requestedPage = Number(params.pagina ?? 1);
  const page = Number.isInteger(requestedPage) && requestedPage > 0 && requestedPage <= 10000 ? requestedPage : 1;
  const result = await readWaitlist(clinic.id, { pagina: page, ...(justToday && { desde: localDateKey(new Date(), clinic.timezone) }) });
  const href = (p = 1, today = justToday) => `/panel/lista-espera?pagina=${p}${today ? "&hoy=1" : ""}`;
  return (
    <>
      <PageHeader title="Lista de espera" description="Pacientes que aceptaron que les avisemos si aparece un horario. Su turno actual se conserva." />
      <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
        <Link href={href(1, false)} className={secondaryButtonClass} aria-current={!justToday ? "page" : undefined}>Todos los pendientes</Link>
        <Link href={href(1, true)} className={secondaryButtonClass} aria-current={justToday ? "page" : undefined}>Anotados hoy</Link>
        <a href={href(page)} className={secondaryButtonClass}>Actualizar</a>
        <span className="text-brand-900/65">{result.total} en espera · Consultada {formatDateTime(result.actualizada_a, clinic.timezone)}</span>
      </div>
      <p className="mb-4 text-sm text-brand-900/65">«Activa»: espera un ofrecimiento. «Ofrecida»: ya se le avisó de un horario. Las propuestas que todavía no aceptaron no aparecen en esta lista.</p>
      {result.pacientes.length ? (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-left text-sm">
            <thead className="bg-brand-50 text-brand-900/70"><tr>
              <th scope="col" className="px-4 py-3">Paciente</th><th scope="col" className="px-4 py-3">Qué espera</th>
              <th scope="col" className="px-4 py-3">Preferencias</th><th scope="col" className="px-4 py-3">Estado</th>
              <th scope="col" className="px-4 py-3">Turno que conserva</th>
            </tr></thead>
            <tbody className="divide-y divide-brand-900/5">{result.pacientes.map((p) => (
              <tr key={p.espera_id}>
                <td className="px-4 py-3"><Link href={`/panel/pacientes/${p.paciente_id}`} className="font-semibold text-brand-700 hover:underline">{p.paciente}</Link><p>{p.celular}</p><p className="text-xs text-brand-900/60">Anotado: {p.anotado}{p.anotado_hoy ? " · hoy" : ""}</p></td>
                <td className="px-4 py-3">{p.prestacion}<p className="text-xs text-brand-900/60">{p.profesional}</p></td>
                <td className="max-w-xs px-4 py-3">{p.preferencias}</td>
                <td className="px-4 py-3">{p.estado === "ofrecida" ? "Ofrecida" : "Activa"}{p.ultimo_ofrecimiento && <p className="text-xs text-brand-900/60">{p.ultimo_ofrecimiento}</p>}</td>
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
