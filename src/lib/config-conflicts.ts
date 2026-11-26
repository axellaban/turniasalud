// Contradicciones de la configuración de un consultorio: el mismo dato escrito en dos lugares
// que no dicen lo mismo. Sofi lee los dos, así que el paciente puede recibir dos respuestas.
// Es puro (sin base) para poder probarlo; la Configuración lo muestra arriba de cada pestaña.

import { hoursTextMismatch, scheduleSummary, scheduledDays, weekdayName } from "./hours-summary";
import type { Schedule } from "./types";

/** `info`: no es una contradicción sino algo que conviene saber (por ejemplo, un día en que Sofi no da turnos a propósito). */
export type ConfigConflict = { key: string; message: string; href: string; tone?: "warning" | "info" };

/** Los horarios y la regla de días, para comparar con lo que dice el texto. */
export type ConflictSchedules = {
  schedules: Array<Pick<Schedule, "professional_id" | "weekday" | "start_time" | "end_time" | "urgent_only" | "appointment_type_ids">>;
  professionals: Map<string, string>;
};

export type ConflictInput = {
  faq: string | null;
  policies: string | null;
  agent_context: string | null;
  payment_methods: string | null;
  cancel_notice_hours: number | null;
  reschedule_notice_hours: number | null;
  hours_text?: string | null;
  tone?: string | null;
  booking_weekdays?: number[] | null;
  agent_name?: string | null;
};

const TURNOS = "/panel/configuracion/turnos#mover";
const DATOS = "/panel/configuracion#datos";
const PRESTACIONES = "/panel/configuracion/prestaciones";
const DIAS = "/panel/configuracion/turnos#dias";
const RESPUESTAS = "/panel/configuracion#respuestas";

const USTED = /\btrat\w*\s+(?:siempre\s+)?de\s+usted\b|\bhabl\w*\s+(?:siempre\s+)?de\s+usted\b|\bde\s+usted\b/i;
const VOS = /\btrat\w*\s+(?:siempre\s+)?de\s+vos\b|\btute\w*|\bde\s+vos\b/i;

const list = (items: string[]) => (items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`);

const hours = (n: number) => `${n} ${n === 1 ? "hora" : "horas"}`;

/** Las horas de aviso que pide el texto para una acción («cancelaciones con 24 h de anticipación»). */
export function noticeHoursInText(text: string, action: "cancelar" | "mover"): number | null {
  const verb = action === "cancelar" ? "cancel" : "(?:reprogram|mover|cambi(?:ar|o) (?:el|de) turno)";
  for (const line of text.split(/\n|(?<=\.)\s/)) {
    if (!new RegExp(verb, "i").test(line)) continue;
    const m = line.match(/(\d{1,3})\s*(?:h\b|hs\b|hrs?\b|horas?\b)/i) ?? line.match(/(\d{1,2})\s*d[ií]as?\b/i);
    if (!m) continue;
    const n = Number(m[1]);
    return /d[ií]a/i.test(m[0]) ? n * 24 : n;
  }
  return null;
}

/** Montos escritos en un texto («$45.000», «$ 40000»), en pesos. */
export function amountsInText(text: string): number[] {
  return [...text.matchAll(/\$\s?(\d{1,3}(?:[.\s]\d{3})+|\d{4,})/g)].map((m) => Number(m[1].replace(/[.\s]/g, "")));
}

const PAYMENT = /\b(efectivo|transferencia|d[eé]bito|cr[eé]dito|tarjetas?|mercado ?pago|qr)\b/i;

/** ¿Las preguntas frecuentes ya cuentan cómo se paga? Entonces «Formas de pago» no falta. */
export function faqMentionsPayment(faq: string | null): boolean {
  return Boolean(faq && PAYMENT.test(faq));
}

export function configConflicts(clinic: ConflictInput, prices: number[], agenda?: ConflictSchedules): ConfigConflict[] {
  const out: ConfigConflict[] = [];
  const agent = clinic.agent_name || "Sofi";
  const texts = [clinic.policies, clinic.faq, clinic.agent_context].filter(Boolean).join("\n");

  for (const [action, field, label] of [
    ["cancelar", clinic.cancel_notice_hours, "Aviso mínimo para cancelar"],
    ["mover", clinic.reschedule_notice_hours, "Aviso mínimo para mover"],
  ] as const) {
    const written = noticeHoursInText(texts, action);
    if (written === null) continue;
    if (!field) {
      out.push({
        key: `aviso-${action}`,
        message: `El texto dice ${hours(written)} de aviso para ${action}, pero «${label}» está vacío: Sofi lo dice, pero igual deja ${action} con menos. Cargá ${written} en ese campo para que se cumpla.`,
        href: TURNOS,
      });
    } else if (field !== written) {
      out.push({
        key: `aviso-${action}`,
        message: `El texto dice ${hours(written)} de aviso para ${action} y «${label}» dice ${hours(field)}. Dejá un solo número: el campo es el que se cumple.`,
        href: TURNOS,
      });
    }
  }

  // Un precio en el texto que no es el de ninguna prestación: Sofi puede dar dos precios para lo mismo.
  const known = new Set(prices);
  const stray = [...new Set(amountsInText([clinic.faq, clinic.agent_context].filter(Boolean).join("\n")))].filter((a) => !known.has(a));
  if (stray.length && prices.length) {
    const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
    out.push({
      key: "precios",
      message: `Las preguntas frecuentes dicen ${stray.map((a) => money.format(a)).join(", ")}, que no es el precio de ninguna prestación. Dejá los precios solo en Prestaciones para que Sofi no dé dos distintos.`,
      href: PRESTACIONES,
    });
  }

  // El trato: el selector manda, pero si el texto dice lo contrario Sofi recibe dos órdenes.
  const instructions = [clinic.agent_context, clinic.faq, clinic.policies].filter(Boolean).join("\n");
  if (clinic.tone !== "usted" && USTED.test(instructions)) {
    out.push({ key: "trato", message: `Las instrucciones dicen de tratar de usted, pero «Cómo trata a los pacientes» está en «De vos». Elegí «De usted» en ese campo y sacá la frase del texto.`, href: RESPUESTAS });
  } else if (clinic.tone === "usted" && VOS.test(instructions)) {
    out.push({ key: "trato", message: `Las instrucciones dicen de tratar de vos, pero «Cómo trata a los pacientes» está en «De usted». Dejá uno solo: el campo es el que se cumple.`, href: RESPUESTAS });
  }

  if (agenda) {
    // El horario que dice Sofi contra los horarios con los que da turnos.
    if (hoursTextMismatch(clinic.hours_text, agenda.schedules)) {
      out.push({
        key: "horario",
        message: `«Horario de atención» dice «${clinic.hours_text?.trim()}», pero según Equipo y horarios es «${scheduleSummary(agenda.schedules)}». ${agent} le puede dar al paciente un horario que no es. Usá el armado con los horarios.`,
        href: DATOS,
      });
    }
    // Días con horarios en los que Sofi no da turnos: está bien si es a propósito, pero conviene saberlo.
    if (clinic.booking_weekdays != null) {
      const days = scheduledDays(agenda.schedules, agenda.professionals);
      const skipped = [...days.entries()].filter(([d]) => !clinic.booking_weekdays!.includes(d));
      if (skipped.length) {
        const detail = list(skipped.map(([d, names]) => `${weekdayName(d)} (${list(names)})`));
        out.push({
          key: "dias-sin-turnos",
          tone: "info",
          message: `Hay horarios cargados el ${detail} y ${agent} no da turnos ${skipped.length === 1 ? "ese día" : "esos días"}: al paciente le dice que ${skipped.length === 1 ? "ese día los coordina" : "esos días los coordina"} el equipo. Si querés que los dé, marcalo en «Días en que ${agent} da turnos».`,
          href: DIAS,
        });
      }
    }
  }

  if (clinic.payment_methods?.trim() && faqMentionsPayment(clinic.faq)) {
    out.push({
      key: "pago",
      message: "Las formas de pago están en «Formas de pago» y también en las preguntas frecuentes. Dejalas en un solo lugar para que no se contradigan cuando cambien.",
      href: DATOS,
    });
  }
  return out;
}
