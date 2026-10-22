import { normalizeWebsite } from "./website";

// Lead magnet "Probá la demo con tu web": textos y reglas puras del flujo por
// WhatsApp. El estado y los efectos (base, WAHA, ElevenLabs) están en session.ts.

export type DemoMode = "llamada" | "audio" | "chat";
export type DemoStatus = "analizando" | "eligiendo" | DemoMode | "terminada" | "error";

/** Mensaje que arma la landing /probar-demo. Tiene que seguir siendo reconocible por parseDemoRequest. */
export function demoRequestText(website: string): string {
  return `¡Hola! Quiero probar la demo de Turnia. Te paso mi web: ${website}`;
}

const URL_CANDIDATE = /(?:https?:\/\/)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}(?::\d+)?(?:\/[^\s<>"']*)?/gi;

/** Primera dirección web de un texto (o null). Ignora emails. Puro. */
export function findWebsite(text: string): string | null {
  for (const m of text.matchAll(URL_CANDIDATE)) {
    const before = text[(m.index ?? 0) - 1];
    if (before === "@") continue;
    const website = normalizeWebsite(m[0]);
    if (website) return website;
  }
  return null;
}

/**
 * ¿Es un pedido de demo con una web? Ej.: "quiero probar la demo, mi web es miclinica.com.ar".
 * Exige "demo" o "Turnia" para no confundir a un paciente que manda un link. Puro.
 */
export function parseDemoRequest(text: string): { website: string } | null {
  if (!/\b(demo|turnia)\b/i.test(text)) return null;
  const website = findWebsite(text);
  return website ? { website } : null;
}

const strip = (text: string) =>
  text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u20e3\ufe0f]/g, "")
    .replace(/[*_~.!¡?¿,;:"'()]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/** Qué opción eligió: 1 llamada, 2 audio, 3 chat (por número o por palabra). Puro. */
export function parseModeChoice(text: string): DemoMode | null {
  const t = strip(text);
  if (!t) return null;
  const number = /^(?:opcion\s*)?([123])\b/.exec(t)?.[1];
  if (number) return (["llamada", "audio", "chat"] as const)[Number(number) - 1];
  if (/\b(audios?|nota de voz|notas de voz|mensaje de voz)\b/.test(t)) return "audio";
  if (/\b(llamada|llamar|llamame|llamenme|llamen|telefono|voz)\b/.test(t)) return "llamada";
  if (/\b(chat|texto|escrito|escribir|mensajes?)\b/.test(t)) return "chat";
  return null;
}

/** Comandos durante la demo. Puro. */
export function parseCommand(text: string): "menu" | "salir" | null {
  const t = strip(text);
  if (/^(menu|opciones|cambiar|cambiar modo|volver)$/.test(t)) return "menu";
  if (/^(salir|terminar|finalizar|fin|stop|chau)$/.test(t)) return "salir";
  return null;
}

export const hostOf = (website: string) => new URL(website).hostname.replace(/^www\./, "");

const CHOICES = "1️⃣ *Llamada de voz*\n2️⃣ *Audio de WhatsApp*\n3️⃣ *Chat*";
const FOOTER = "Escribí *MENU* para cambiar de modo o *SALIR* para terminar.";

export const DEMO_TEXTS = {
  started: (website: string) =>
    `¡Hola! 👋 Soy Turnia. Estoy leyendo las secciones principales de *${hostOf(website)}* para conocer tu consultorio: profesionales, prestaciones, horarios y coberturas.\n\nPuede tardar un par de minutos…`,
  stillReading: "Sigo leyendo tu web, ya casi termino… ⏳",
  options: (opts: { name: string; professionals: number; types: number; coverages: number }) =>
    [
      `¡Listo! Ya conozco *${opts.name}*${opts.professionals ? `: ${opts.professionals} profesional${opts.professionals === 1 ? "" : "es"}` : ""}${opts.types ? `${opts.professionals ? "," : ":"} ${opts.types} tipo${opts.types === 1 ? "" : "s"} de turno` : ""}${opts.coverages ? ` y ${opts.coverages} cobertura${opts.coverages === 1 ? "" : "s"}` : ""}.`,
      "Esta es una simulación: la agenda y los turnos son de prueba y no se envían al consultorio. Probala con datos ficticios. ¿Cómo querés que te atienda? Respondé con el número:",
      CHOICES,
    ].join("\n\n"),
  chooseAgain: `Respondé con el número de la opción:\n\n${CHOICES}`,
  chat: (agent: string, name: string) =>
    `Perfecto. Desde ahora te atiende *${agent}*, la recepcionista de *${name}*. Escribile como si fueras un paciente, por ejemplo: «Hola, quiero sacar un turno para la semana que viene».\n\n${FOOTER}`,
  audio: (agent: string, name: string) =>
    `Perfecto. Mandale un *audio* a ${agent}, la recepcionista de *${name}*, como si fueras un paciente que quiere sacar turno. Te va a contestar con audios.\n\n${FOOTER}`,
  callPhone: (agent: string, name: string, phone: string) =>
    `Perfecto. ${agent}, la recepcionista de *${name}*, te está llamando al +${phone}. Atendé y hablale como si fueras un paciente que quiere sacar turno. 📞\n\nSi no te entra la llamada, respondé *1* para que te llame de nuevo. ${FOOTER}`,
  callLink: (agent: string, name: string, link: string) =>
    `Perfecto. Abrí este link para hablar por voz con ${agent}, la recepcionista de *${name}*, desde el celular (te va a pedir permiso para usar el micrófono):\n\n${link}\n\nHablale como si fueras un paciente que quiere sacar turno. 📞\n\n${FOOTER}`,
  callLimit: "Ya usaste las 3 llamadas de esta demo. Escribí *MENU* para probar chat o audio.",
  inCall: `Estás en modo llamada. Respondé *1* para que te vuelva a llamar o elegí otra opción:\n\n${CHOICES}`,
  ended: (name: string | null) =>
    `¡Gracias por probar Turnia! 🙌 Así atendería${name ? ` *${name}*` : " tu consultorio"} las 24 horas, por WhatsApp y por teléfono.\n\nEn breve alguien del equipo te escribe para contarte cómo dejarla funcionando. Si querés probar con otra web, mandá «Quiero probar la demo» con la dirección.`,
  scrapeFailed: (website: string) =>
    `No pude abrir *${hostOf(website)}* 😕. ¿Revisás que la dirección esté bien y me la mandás de nuevo? Por ejemplo: «Quiero probar la demo, mi web es miclinica.com.ar».`,
  failed: "Perdón, tuve un problema para preparar la demo. ¿Me mandás tu web de nuevo en un ratito?",
  tooMany: "Ya probaste varias demos hoy 🙌. Alguien del equipo te va a escribir para seguir. Si querés, contanos qué te gustaría ver.",
};


/** Contexto para el agente: quién le escribe y qué es de prueba. */
export function demoAgentContext(clinicName: string, opts: { defaultHours: boolean }): string {
  return [
    `DEMO DE TURNIA: te escribe el dueño o alguien del equipo de ${clinicName} para probar cómo atenderías a sus pacientes.`,
    `Atendelo exactamente como la recepcionista de ${clinicName}: tratalo como un paciente, respondé con la información de la clínica, pedí sus datos y ofrecé y reservá turnos con las herramientas.`,
    "La agenda es de prueba: los turnos que reserves no le llegan a la clínica real; no hace falta aclararlo salvo que pregunte.",
    opts.defaultHours ? "La web no informa horarios: la agenda usa un horario de prueba, de lunes a viernes de 9 a 18." : "",
    "Si pregunta algo que la información de la clínica no dice (precios, coberturas), no lo inventes: decí que lo consultás con el equipo y creá la tarea, como en la vida real.",
    "Si pregunta por Turnia o por cómo contratarlo, contale que esto es una demo de Turnia Salud y que el equipo lo va a contactar.",
  ]
    .filter(Boolean)
    .join(" ");
}
