// Prospección a odontólogos: mensajes, links y reglas de seguimiento. Sin base de datos, para
// usarlo igual en el servidor, en el navegador y en los tests.

import { addDaysKey, weekdayOfKey } from "@/lib/time";

export const OUTREACH_STATUSES = ["por_contactar", "contactado", "respondio", "reunion", "cliente", "no_interesa", "sin_canal", "baja"] as const;
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number];

export const STATUS_LABEL: Record<OutreachStatus, string> = {
  por_contactar: "Por contactar",
  contactado: "Contactado",
  respondio: "Respondió",
  reunion: "Reunión",
  cliente: "Cliente",
  no_interesa: "No le interesa",
  sin_canal: "Sin WhatsApp",
  baja: "Pidió no recibir más",
};

export const STATUS_TONE: Record<OutreachStatus, "gray" | "green" | "yellow" | "red" | "blue"> = {
  por_contactar: "gray",
  contactado: "blue",
  respondio: "yellow",
  reunion: "green",
  cliente: "green",
  no_interesa: "gray",
  sin_canal: "red",
  baja: "red",
};

/** Estados que salen de la cola: ya no se les escribe. */
export const CLOSED: OutreachStatus[] = ["no_interesa", "sin_canal", "baja", "cliente"];

export const CHANNELS = ["whatsapp", "instagram", "telefono", "persona", "email"] as const;
export type OutreachChannel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<OutreachChannel, string> = {
  whatsapp: "WhatsApp",
  instagram: "Instagram",
  telefono: "Llamada",
  persona: "En persona",
  email: "Email",
};

/** Tres toques como mucho: el primero y dos seguimientos. */
export const MAX_TOUCHES = 3;

/**
 * De quién es el teléfono: su celular, el celular del consultorio (el WhatsApp que figura en su web,
 * lo lee la recepción) o un fijo. Los dos últimos reciben el mensaje pensado para la recepción.
 */
export const PHONE_KINDS = ["movil", "consultorio", "fijo"] as const;
export type PhoneKind = (typeof PHONE_KINDS)[number];
export const PHONE_KIND_LABEL: Record<PhoneKind, string> = { movil: "Celular", consultorio: "Celular del consultorio", fijo: "Fijo" };

/** Lo atiende el consultorio (la recepción), no la persona. */
export const isBusinessLine = (kind: PhoneKind | null) => kind === "consultorio" || kind === "fijo";

export type OutreachPerson = {
  code: string;
  name: string;
  greeting: string;
  title: string;
  business_name: string;
  zone: string;
  address: string;
  specialty: string;
  phone: string | null;
  phone_kind: PhoneKind | null;
  instagram: string | null;
  website: string | null;
  touches: number;
  /** Cuándo se le mandó el saludo de WhatsApp (sin link). No cuenta como toque. */
  greeted_at?: string | null;
};

export const TEMPLATE_KEYS = ["whatsapp_saludo", "whatsapp_saludo_consultorio", "whatsapp_1", "whatsapp_consultorio", "whatsapp_2", "whatsapp_3", "whatsapp_demo", "instagram", "llamada"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type Templates = Record<TemplateKey, string>;

export const TEMPLATE_LABEL: Record<TemplateKey, { title: string; hint: string }> = {
  whatsapp_saludo: {
    title: "WhatsApp: saludo a la persona",
    hint: "Va siempre primero, sin link: que un desconocido mande un link de entrada es lo que hace que WhatsApp bloquee el número. Cuando responde, le mandás la presentación.",
  },
  whatsapp_saludo_consultorio: { title: "WhatsApp: saludo al número del consultorio", hint: "Lo mismo, para el fijo o el celular del consultorio: lo lee la recepción." },
  whatsapp_1: { title: "WhatsApp: presentación a la persona", hint: "Después del saludo, para su celular. Lleva el link de su demo." },
  whatsapp_consultorio: {
    title: "WhatsApp: presentación al número del consultorio",
    hint: "Fijo, celular del consultorio o un número que comparten varios: lo lee la recepción. Le pide que se lo pase a quien decide, sin que suene a reemplazo.",
  },
  whatsapp_2: { title: "WhatsApp: seguimiento", hint: "Dos días hábiles después, si no respondió." },
  whatsapp_3: { title: "WhatsApp: último mensaje", hint: "Cuatro días hábiles después del seguimiento. Después no se le escribe más." },
  whatsapp_demo: { title: "WhatsApp: después de probar la demo", hint: "Reemplaza al seguimiento cuando ya la probó. No le digas que viste que la probó: preguntale." },
  instagram: { title: "Instagram: mensaje directo", hint: "Sin link: los pedidos de mensaje con links se filtran. Si contesta, le pasás el link." },
  llamada: { title: "Llamada: guion", hint: "No se envía: es para leer mientras llamás. El objetivo es conseguir el WhatsApp de quien decide." },
};

export const DEFAULT_TEMPLATES: Templates = {
  whatsapp_saludo: "¡Buenas! ¿Hablo con {saludo}?",
  whatsapp_saludo_consultorio: "¡Buenas! ¿Hablo con el consultorio de {destinatario}?",
  whatsapp_1:
    "Hola {saludo}, ¿cómo estás? Soy Axel, de Turnia.\n" +
    "Te armé una demo con tu consultorio: Sofi contesta el WhatsApp cuando estás atendiendo o fuera de horario, responde las consultas y da el turno.\n" +
    "Probala en un minuto, como si fueras un paciente: {link}\n" +
    "Si te interesa, te la muestro en 15 minutos. Y si no, avisame y no te escribo más.",
  whatsapp_consultorio:
    "Hola, ¿cómo están? Soy Axel, de Turnia.\n" +
    "Le armé a {destinatario} una demo con el consultorio: Sofi contesta el WhatsApp a la noche y los fines de semana, y deja los turnos dados para que a la mañana no haya mensajes acumulados.\n" +
    "¿Se la pueden pasar? Es este link: {link}\n" +
    "¡Gracias! Y si no les interesa, me avisan y no escribo más.",
  whatsapp_2:
    "Hola {saludo}, te escribo de nuevo por si quedó tapado entre mensajes.\n" +
    "Se viene la temporada y con los turistas aumentan las consultas por WhatsApp a cualquier hora. Sofi las contesta al instante y deja el turno dado.\n" +
    "La demo con tu consultorio sigue acá: {link}\n" +
    "¿Te la muestro esta semana? Son 15 minutos.",
  whatsapp_3:
    "Hola {saludo}, último mensaje, prometido. ¿Te sirve que te muestre la demo en 15 minutos esta semana, o lo dejamos acá? Cualquiera de las dos está perfecto.",
  whatsapp_demo:
    "Hola {saludo}, ¿llegaste a probar la demo? ¿Qué te pareció?\n" +
    "Si te sirve, la dejamos andando con tus horarios y tus tratamientos. Te muestro cómo en 15 minutos, ¿te queda bien esta semana?",
  instagram:
    "Hola {saludo}! Soy Axel, de Turnia. Armé una demo de Sofi con tu consultorio: contesta el WhatsApp cuando estás atendiendo o fuera de horario y da los turnos sola. ¿Te paso el link para probarla? Es un minuto.",
  llamada:
    "Hola, ¿qué tal? ¿Es el consultorio de {destinatario}? Soy Axel, de Turnia. Le preparé una demo de una asistente que contesta el WhatsApp del consultorio y da turnos cuando nadie puede atender. ¿Me pasás un WhatsApp para mandársela? Si es el de {saludo}, mejor: así la prueba directo.",
};

export const TEMPLATE_VARIABLES = [
  ["{saludo}", "nombre de pila"],
  ["{nombre}", "nombre completo"],
  ["{destinatario}", "«la Dra. Pérez» o el nombre completo"],
  ["{consultorio}", "nombre del consultorio en la demo"],
  ["{link}", "su demo"],
  ["{zona}", "ciudad"],
] as const;

/** Los mensajes guardados en el panel, completando con los de fábrica los que falten. */
export function mergeTemplates(saved: unknown): Templates {
  const out = { ...DEFAULT_TEMPLATES };
  if (saved && typeof saved === "object") {
    for (const key of TEMPLATE_KEYS) {
      const value = (saved as Record<string, unknown>)[key];
      if (typeof value === "string" && value.trim()) out[key] = value;
    }
  }
  return out;
}

export function demoUrl(appUrl: string, code: string): string {
  return `${appUrl.replace(/\/$/, "")}/p/${code}`;
}

/** «la Dra. Moreta» o «el Dr. Secreti» si sabemos cómo se presenta; si no, su nombre completo. */
export function recipientLabel(person: Pick<OutreachPerson, "name" | "title">): string {
  const surname = person.name.split(/\s+/).filter((w) => !/^[A-ZÁÉÍÓÚÑ]\.$/.test(w)).slice(-1)[0] ?? person.name;
  if (person.title === "Dra.") return `la Dra. ${surname}`;
  if (person.title === "Dr.") return `el Dr. ${surname}`;
  return person.name;
}

/** «el Dr. Emiliano Capris», «la Dra. Myriam Moreta» o, sin trato, el nombre solo. */
export function withArticle(title: string, name: string): string {
  return title === "Dra." ? `la Dra. ${name}` : title === "Dr." ? `el Dr. ${name}` : name;
}

/** «del Consultorio Odontológico Capris», «de la Clínica Dental Sur», «de ACHE Odontología». */
export function ofBusiness(name: string): string {
  if (/^(consultorio|centro|estudio|instituto)\b/i.test(name)) return `del ${name}`;
  if (/^(cl[ií]nica|unidad)\b/i.test(name)) return `de la ${name}`;
  return `de ${name}`;
}

export function renderTemplate(template: string, person: OutreachPerson, link: string): string {
  const values: Record<string, string> = {
    saludo: person.greeting || person.name.split(/\s+/)[0] || "",
    nombre: person.name,
    destinatario: recipientLabel(person),
    consultorio: person.business_name || `el consultorio de ${person.name}`,
    link,
    zona: person.zone,
  };
  return template
    .replace(/\{(saludo|nombre|destinatario|consultorio|link|zona)\}/g, (_, key: string) => values[key])
    // «a el Dr. Arias» → «al Dr. Arias»; «de el Dr.» → «del Dr.».
    .replace(/\b([Aa]|[Dd]e) el Dr\./g, "$1l Dr.");
}

/**
 * Qué mensaje de WhatsApp toca: el saludo sin link, la presentación con la demo (a la persona o, si
 * el número es del consultorio, a la recepción), el seguimiento o el último. `null` cuando ya se le
 * escribió tres veces.
 */
export function whatsappTemplateKey(
  person: Pick<OutreachPerson, "touches" | "phone_kind" | "greeted_at"> & { demo_at?: string | null },
  sharedPhone: boolean,
): TemplateKey | null {
  if (person.touches >= MAX_TOUCHES) return null;
  const reception = isBusinessLine(person.phone_kind) || sharedPhone;
  if (person.touches === 0 && !person.greeted_at) return reception ? "whatsapp_saludo_consultorio" : "whatsapp_saludo";
  if (person.touches === 0) return reception ? "whatsapp_consultorio" : "whatsapp_1";
  if (person.demo_at) return "whatsapp_demo";
  return person.touches === 1 ? "whatsapp_2" : "whatsapp_3";
}

/** Links de WhatsApp: wa.me (celular) y WhatsApp Web (computadora). */
export function whatsappLinks(phone: string, text: string): { web: string; app: string } {
  const digits = phone.replace(/\D/g, "");
  const encoded = encodeURIComponent(text);
  return { web: `https://web.whatsapp.com/send?phone=${digits}&text=${encoded}`, app: `https://wa.me/${digits}?text=${encoded}` };
}

/** «@dra.perez», «instagram.com/dra.perez/» o el link completo → «dra.perez». */
export function normalizeInstagram(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const fromUrl = /instagram\.com\/([^/?#\s]+)/i.exec(trimmed)?.[1];
  const handle = (fromUrl ?? trimmed).replace(/^@/, "").toLowerCase();
  return /^[a-z0-9._]{1,30}$/.test(handle) && !["p", "reel", "explore", "stories"].includes(handle) ? handle : null;
}

/**
 * Teléfono argentino para la ficha: +54 9 y área y número para celular (de la persona o del
 * consultorio), +54 y área y número para fijo. Acepta lo que se pega de una web (0223 15 412-3456,
 * 223 4123456, +54 9 223…).
 */
export function outreachPhone(raw: string | null | undefined, kind: PhoneKind | null = null): { phone: string; kind: PhoneKind } | null {
  if (!raw) return null;
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  let mobile: boolean | null = kind ? kind !== "fijo" : null;
  if (digits.startsWith("54")) {
    digits = digits.slice(2);
    if (digits.startsWith("9")) {
      digits = digits.slice(1);
      mobile = true;
    }
  } else if (digits.startsWith("0")) digits = digits.slice(1);
  // El 15 va después del área (2 a 4 dígitos) y marca un celular.
  for (const areaLength of [2, 3, 4]) {
    if (digits.length === 12 && digits.slice(areaLength, areaLength + 2) === "15") {
      digits = digits.slice(0, areaLength) + digits.slice(areaLength + 2);
      mobile = true;
      break;
    }
  }
  if (digits.length !== 10) return null;
  const isMobile = mobile ?? false;
  return { phone: `+54${isMobile ? "9" : ""}${digits}`, kind: isMobile ? (kind === "consultorio" ? "consultorio" : "movil") : "fijo" };
}

// Áreas de tres dígitos (Mar del Plata es 223); el resto del interior usa cuatro (Miramar, 2291).
const AREAS_3 = new Set("220 221 223 230 236 237 249 260 261 263 264 266 280 291 294 297 298 299 336 341 342 343 345 348 351 353 358 362 364 370 376 379 380 381 383 385 387 388".split(" "));

export function displayOutreachPhone(phone: string | null): string {
  if (!phone) return "—";
  const m = /^\+54(9?)(\d{10})$/.exec(phone);
  if (!m) return phone;
  const n = m[2];
  const area = n.startsWith("11") ? 2 : AREAS_3.has(n.slice(0, 3)) ? 3 : 4;
  const rest = n.slice(area);
  return `+54 ${m[1] ? "9 " : ""}${n.slice(0, area)} ${rest.slice(0, rest.length - 4)}-${rest.slice(-4)}`;
}

/** Suma días hábiles (lunes a viernes) a una fecha aaaa-mm-dd. */
export function addBusinessDays(key: string, days: number): string {
  let out = key;
  let left = days;
  while (left > 0) {
    out = addDaysKey(out, 1);
    const weekday = weekdayOfKey(out);
    if (weekday !== 0 && weekday !== 6) left--;
  }
  return out;
}

/** Cuándo toca el próximo mensaje después del toque número `touches` (1, 2 o 3). */
export function nextFollowUp(today: string, touches: number): string | null {
  if (touches >= MAX_TOUCHES) return null;
  return addBusinessDays(today, touches === 1 ? 2 : 4);
}

/** El lunes de la semana de una fecha aaaa-mm-dd. */
export function weekStart(key: string): string {
  const weekday = weekdayOfKey(key);
  return addDaysKey(key, weekday === 0 ? -6 : 1 - weekday);
}

export function googleSearchUrl(person: Pick<OutreachPerson, "name" | "zone">, instagram = false): string {
  const query = instagram ? `site:instagram.com ${person.name} odontología ${person.zone}` : `"${person.name}" odontología ${person.zone}`;
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}
