import "server-only";
import { sql } from "./db";
import type { Clinic } from "./types";

export type CompletenessItem = { label: string; done: boolean; href: string };

const filled = (value: string | null | undefined) => Boolean(value && value.trim());

/** Qué le falta a la ficha para que el agente responda bien, con dónde completarlo. */
export async function profileCompleteness(clinic: Clinic): Promise<{ percent: number; items: CompletenessItem[] }> {
  const [catalog] = await sql<{ pros: number; pros_without_hours: number; types: number; types_without_price: number }[]>`
    select
      (select count(*)::int from professionals p where p.clinic_id = ${clinic.id} and p.active) as pros,
      (select count(*)::int from professionals p where p.clinic_id = ${clinic.id} and p.active
         and not exists (select 1 from schedules s where s.professional_id = p.id)) as pros_without_hours,
      (select count(*)::int from appointment_types t where t.clinic_id = ${clinic.id} and t.active) as types,
      (select count(*)::int from appointment_types t where t.clinic_id = ${clinic.id} and t.active and t.price is null) as types_without_price`;
  const rules = "/panel/configuracion";
  const items: CompletenessItem[] = [
    { label: "Teléfono", done: filled(clinic.phone), href: `${rules}#datos` },
    { label: "Dirección", done: filled(clinic.address), href: `${rules}#datos` },
    { label: "Horario de atención", done: filled(clinic.hours_text), href: `${rules}#atencion` },
    { label: "Coberturas", done: clinic.accepted_coverages.length > 0, href: `${rules}#atencion` },
    { label: "Formas de pago", done: filled(clinic.payment_methods), href: `${rules}#atencion` },
    { label: "Preguntas frecuentes", done: filled(clinic.faq), href: `${rules}#respuestas` },
    { label: "Políticas (cancelación, tolerancia)", done: filled(clinic.policies), href: `${rules}#respuestas` },
    { label: "Qué decir fuera de horario", done: filled(clinic.after_hours_instructions), href: `${rules}#urgencias` },
    { label: "Horarios de cada profesional", done: catalog.pros > 0 && catalog.pros_without_hours === 0, href: `${rules}/equipo` },
    { label: "Precios de las prestaciones", done: catalog.types > 0 && catalog.types_without_price === 0, href: `${rules}/prestaciones` },
  ];
  return { percent: Math.round((items.filter((i) => i.done).length / items.length) * 100), items };
}
