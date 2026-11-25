// Cómo se ve un mensaje de Sofi en WhatsApp: como lo escribiría una persona de recepción.
// Sin negritas ni signos de apertura, y en burbujas cortas (una idea por mensaje), no un bloque.
// Este archivo no manda nada: arma el texto. El envío está en whatsapp-send.ts.

/** Más burbujas seguidas ya parece un bot que dispara mensajes. */
export const MAX_BUBBLES = 3;

/**
 * El texto del agente, listo para WhatsApp: sin Markdown, sin negritas (ni **así** ni *así*), sin
 * títulos y sin «¿» ni «¡» (nadie los escribe en el celular). Los links de Markdown quedan como
 * «texto: url». No toca la plantilla de la ficha de salud: esa va aparte, tal cual.
 */
export function toWhatsAppText(text: string): string {
  return withoutFormulas(text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, "$1: $2")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    // *negrita* de WhatsApp (sin tocar un asterisco suelto, como «5 * 2»).
    .replace(/(^|[^\p{L}\p{N}*])\*(?=\S)([^*\n]*?\S)\*(?![\p{L}\p{N}*])/gmu, "$1$2")
    .replace(/^#{1,6}\s+/gm, "")
    // Viñetas de Markdown: un guion, como en un mensaje escrito a mano.
    .replace(/^(\s*)[*•]\s+/gm, "$1- ")
    .replace(/[¿¡]/g, "")
    .replace(/[ \t]+$/gm, "")
    .trim());
}

// Fórmulas que una recepcionista no escribe por WhatsApp. El prompt ya las prohíbe, pero a veces se
// escapan: acá se sacan cuando son una frase suelta al final del mensaje, o el «Con gusto» del
// principio. Si el mensaje no tiene otra cosa (contesta un «chau»), queda como está.
const CLOSING_FORMULAS = [
  /(?:que\s+)?tenga(?:s)?\s+(?:un\s+)?(?:muy\s+)?(?:buen|lindo|excelente|hermoso)\s+(?:día|fin de semana|resto del día)(?:\s+también)?/,
  /(?:quedamos|quedo)\s+a\s+(?:(?:su|tu)\s+)?(?:entera\s+)?disposición(?:\s+para lo que (?:necesite|necesites))?/,
  /(?:necesita|necesitás|necesitas)\s+algo\s+más/,
  /(?:hay\s+)?algo\s+más\s+en\s+(?:lo\s+)?(?:que|lo que)\s+(?:le|te)?\s*(?:pueda|puedo)\s+ayudar/,
  /(?:tiene|tenés|tienes)\s+(?:alguna\s+)?otra\s+consulta/,
  /cualquier\s+(?:cosa|duda|consulta),?\s+(?:nos|me)\s+(?:escribe|escribís|escribes|avisa|avisás)(?:\s+por\s+acá)?/,
  /hasta\s+pronto/,
];
const FORMULA_SENTENCE = new RegExp(
  `(^|[.!?…]\\s+|\\n+)(?:${CLOSING_FORMULAS.map((r) => r.source).join("|")})[.!?…]*\\s*(?:🙂|😊)?\\s*$`,
  "iu",
);

/** Saca las fórmulas de cierre del final y el «Con gusto» del principio. Pura. */
export function withoutFormulas(text: string): string {
  let out = text.trim();
  for (let i = 0; i < 3; i++) {
    const match = FORMULA_SENTENCE.exec(out);
    if (!match) break;
    const rest = out.slice(0, match.index + (match[1].match(/^[.!?…]/) ? 1 : 0)).trim();
    if (!/\p{L}/u.test(rest)) break;
    out = rest;
  }
  const opening = /^(?:con\s+(?:mucho\s+)?gusto)[,.!]?\s+(?=\p{L})/iu;
  if (opening.test(out)) {
    const rest = out.replace(opening, "");
    out = rest.charAt(0).toUpperCase() + rest.slice(1);
  }
  // «Sí, con gusto. Para…» → «Sí. Para…»
  return out.replace(/^(s[ií]|claro|perfecto|listo),\s+con\s+(?:mucho\s+)?gusto(?=[.!,])/iu, "$1");
}

/**
 * Las burbujas de un mensaje: cada párrafo (separado por una línea en blanco) es una. Si hay más de
 * MAX_BUBBLES, los últimos van juntos en la última.
 */
export function splitBubbles(text: string, max = MAX_BUBBLES): string[] {
  const parts = text.split(/\n[ \t]*\n+/).map((p) => p.trim()).filter(Boolean);
  if (parts.length <= max) return parts;
  return [...parts.slice(0, max - 1), parts.slice(max - 1).join("\n\n")];
}

/** Cuánto «escribe» antes de una burbuja: más largo, más tiempo, como una persona (entre 0,8 y 2,5 s). */
export function typingMs(bubble: string): number {
  return Math.round(Math.min(2500, Math.max(800, 400 + bubble.length * 20)));
}

/** «Consulta de implantes» → «consulta de implantes», para usarlo dentro de una frase. */
const inSentence = (name: string) => (/^\p{Lu}\p{Ll}/u.test(name) ? name[0].toLowerCase() + name.slice(1) : name);

/** «el Dr. Mininni», «la Dra. Ruiz» o el nombre tal cual. */
export function withArticle(professional: string): string {
  const name = professional.trim();
  if (/^dra\.?\s/i.test(name)) return `la ${name}`;
  if (/^dr\.?\s/i.test(name)) return `el ${name}`;
  return name;
}

/**
 * La confirmación de un turno que Turnia verificó en el sistema del consultorio, en burbujas cortas.
 * Sin «tu» ni «su», así sirve para las clínicas que tutean y para las que tratan de usted.
 */
export function confirmationBubbles(input: {
  startsAt: Date;
  timeZone: string;
  professional: string;
  typeName: string;
  address: string | null;
  instructions: string | null;
}): string[] {
  const fmt = (o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("es-AR", { timeZone: input.timeZone, ...o }).format(input.startsAt);
  const weekday = fmt({ weekday: "long" });
  const day = fmt({ day: "numeric", month: "numeric" });
  const time = fmt({ hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
  return [
    `Listo, quedó confirmado el turno de ${inSentence(input.typeName)} para el ${weekday} ${day} a las ${time} con ${withArticle(input.professional)}.`,
    input.address?.trim() && `📍 ${input.address.trim()}`,
    input.instructions?.trim(),
    `Nos vemos el ${weekday} 🙂`,
  ].filter((b): b is string => Boolean(b));
}
