// Contradicciones de la configuración de un consultorio: el mismo dato escrito en dos lugares
// que no dicen lo mismo. Sofi lee los dos, así que el paciente puede recibir dos respuestas.
// Es puro (sin base) para poder probarlo; la Configuración lo muestra arriba de cada pestaña.

export type ConfigConflict = { key: string; message: string; href: string };

export type ConflictInput = {
  faq: string | null;
  policies: string | null;
  agent_context: string | null;
  payment_methods: string | null;
  cancel_notice_hours: number | null;
  reschedule_notice_hours: number | null;
};

const TURNOS = "/panel/configuracion/turnos#mover";
const DATOS = "/panel/configuracion#datos";
const PRESTACIONES = "/panel/configuracion/prestaciones";

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

export function configConflicts(clinic: ConflictInput, prices: number[]): ConfigConflict[] {
  const out: ConfigConflict[] = [];
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

  if (clinic.payment_methods?.trim() && faqMentionsPayment(clinic.faq)) {
    out.push({
      key: "pago",
      message: "Las formas de pago están en «Formas de pago» y también en las preguntas frecuentes. Dejalas en un solo lugar para que no se contradigan cuando cambien.",
      href: DATOS,
    });
  }
  return out;
}
