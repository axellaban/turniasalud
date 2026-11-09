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
  /** Cuándo se le mandó el Paso 1 (el saludo de WhatsApp, sin link). No cuenta como toque. */
  greeted_at?: string | null;
  /** Cuándo se le mandó el Paso 2 (el gancho que pide permiso para pasar el link). Tampoco cuenta como toque. */
  permission_at?: string | null;
  /** Cuándo respondió por última vez (lo que leyó la lectura de WhatsApp o lo que se registró a mano). */
  last_reply_at?: string | null;
};

/**
 * La secuencia de WhatsApp (09/11). Los números de los consultorios los lee la recepción, así que
 * todos los mensajes le hablan a ella (no hay versión para el celular de la persona):
 * - Paso 1, el abridor: confirma que es la recepción y, cuando responde, habilita los links.
 * - Paso 2, el gancho de permiso: cuando responde el Paso 1. Sin link: pregunta si se lo puede pasar.
 * - Paso 3, la entrega y el puente al médico: cuando dice que sí. El link de su demo y el pedido de
 *   reenviárselo a los doctores.
 * - Seguimiento 1: si no respondió el Paso 2 en 24 h, el link directo igual.
 * - Seguimiento 2: a las 24 h del link, si no habló más (un audio de unos 12 segundos; este es el guion).
 * - Seguimiento 3: a las 48-72 h, el «Caballo de Troya»: dos mensajes, el segundo listo para que la
 *   recepción lo reenvíe a los doctores. Después no se le escribe más.
 * - Feedback de no interesados: a quien respondió que no, una vez, cierra la charla y pide en una línea por qué.
 * Los Pasos 1 y 2 no cuentan como uno de los tres mensajes: los tres son el link (Paso 3 o
 * Seguimiento 1), el Seguimiento 2 y el 3. Una línea con «---» separa dos mensajes que salen uno
 * después del otro.
 */
export const TEMPLATE_KEYS = ["whatsapp_abridor", "whatsapp_permiso", "whatsapp_permiso_turno", "whatsapp_entrega", "whatsapp_sin_respuesta", "whatsapp_seguimiento", "whatsapp_reenviable", "whatsapp_feedback", "instagram", "llamada"] as const;
export type TemplateKey = (typeof TEMPLATE_KEYS)[number];
export type Templates = Record<TemplateKey, string>;

export const TEMPLATE_LABEL: Record<TemplateKey, { title: string; hint: string }> = {
  whatsapp_abridor: {
    title: "WhatsApp · Paso 1: el abridor",
    hint: "Va siempre primero y sin link: confirma que es la recepción y, cuando responde, habilita los links. Que un desconocido mande un link de entrada es lo que hace que WhatsApp bloquee el número.",
  },
  whatsapp_permiso: {
    title: "WhatsApp · Paso 2: el gancho de permiso",
    hint: "Cuando responden el Paso 1 («Hola, sí, ¿qué necesitás?»). Sin link: pide permiso para pasarlo.",
  },
  whatsapp_permiso_turno: {
    title: "WhatsApp · Paso 2, si creen que sos un paciente",
    hint: "Cuando contestan el Paso 1 como a un paciente («¿Es por un turno?», «¿Para cuándo?»). Aclara que no y sigue como el Paso 2. Sin link; tampoco cuenta como uno de los tres. Chapa Labs lo sugiere solo en «Responder».",
  },
  whatsapp_entrega: {
    title: "WhatsApp · Paso 3: la entrega y el puente al médico",
    hint: "Cuando dicen «Dale, pasame» o «Sí, a ver». Lleva el link de su demo y le pide que se lo reenvíe a los doctores.",
  },
  whatsapp_sin_respuesta: {
    title: "WhatsApp · Seguimiento 1: sin respuesta al Paso 2",
    hint: "A las 24 horas, si clavó el visto en el Paso 2 y no pidió el link: el link directo igual.",
  },
  whatsapp_seguimiento: {
    title: "WhatsApp · Seguimiento 2: a las 24 h del link",
    hint: "Si no habló más después del link. Va como audio de unos 12 segundos: este es el guion (y el texto, si sale escrito).",
  },
  whatsapp_reenviable: {
    title: "WhatsApp · Seguimiento 3: el mensaje para reenviar",
    hint: "A las 48-72 horas. Son dos mensajes (los separa la línea «---»): el segundo queda solo, para que lo mantengan apretado y lo reenvíen a los doctores. Después no se le escribe más.",
  },
  whatsapp_feedback: {
    title: "WhatsApp · Feedback de no interesados",
    hint: "A quien respondió que no le interesa: una sola vez, cierra la charla y le pide en una línea por qué. No cuenta como uno de los tres mensajes.",
  },
  instagram: { title: "Instagram: mensaje directo", hint: "Sin link: los pedidos de mensaje con links se filtran. Si contesta, le pasás el link." },
  llamada: { title: "Llamada: guion", hint: "No se envía: es para leer mientras llamás. El objetivo es conseguir el WhatsApp de quien decide." },
};

/** Separa dos mensajes que salen uno después del otro (como en Follow-up de Chapa Labs). */
export const MESSAGE_BREAK = "\n---\n";
/** Los mensajes de un texto con «---» entre medio (uno solo si no tiene). */
export const splitMessages = (text: string) => text.split(/\n[ \t]*-{3,}[ \t]*\n/).map((t) => t.trim()).filter(Boolean);

export const DEFAULT_TEMPLATES: Templates = {
  whatsapp_abridor: "Buenas! Hablo con la recepción de {destinatario}?",
  whatsapp_permiso:
    "Qué tal! Soy Axel. Sé que en recepción viven a mil con el WhatsApp, así que les armé gratis una ayudante virtual cargada con los datos de {destinatario}.\n\n" +
    "Sirve para que conteste sola las preguntas repetidas de obras sociales, precios y horarios fuera de hora, así no llegan el lunes a la mañana con 100 mensajes atrasados.\n\n" +
    "Seguro tiene algún error porque la armé rápido con la info que encontré en internet. ¿Te paso el link por acá y la probás 20 segundos como paciente a ver si le pifié en algo?",
  whatsapp_permiso_turno:
    "No, tranqui, no es por un turno! Soy Axel. Sé que en recepción viven a mil con el WhatsApp, así que les armé gratis una ayudante virtual cargada con los datos de {destinatario}.\n\n" +
    "Contesta sola las preguntas repetidas de obras sociales, precios y horarios, también fuera de hora, así no llegan el lunes a la mañana con 100 mensajes atrasados.\n\n" +
    "Seguro tiene algún error porque la armé rápido con la info que encontré en internet. ¿Te paso el link por acá y la probás 20 segundos como paciente a ver si le pifié en algo?",
  whatsapp_entrega:
    "Acá tenés: {link}\n\n" +
    "Mandale un audio o escribile haciéndole alguna pregunta difícil como si fueras un paciente real!\n\n" +
    "Si ves que responde bien, reenviale el link a los doctores: además de sacarte preguntas repetidas a vos, a ellos les rellena solos los huecos de turnos que se cancelan sobre la hora. Avisame si le encontraste algún error!",
  whatsapp_sin_respuesta:
    "Buenas! Sé que en recepción no paran un segundo, así que te dejo directo acá la prueba que armé para {destinatario} por si querés chusmear en 20 segundos si cargué bien los datos: {link}",
  whatsapp_seguimiento:
    "Buenas! ¿Cómo va? Che, te consulto rápido: ¿pudiste hacerle alguna pregunta difícil al link que te pasé ayer o mostrárselo a los doctores? Avisame si le pifié en alguna obra social así ya lo corrijo!",
  whatsapp_reenviable:
    "Buenas! Para no robarte más tiempo a vos en recepción, te dejo acá abajo un resumen cortito listo por si querés tocar \"Reenviar\" y pasárselo directo al WhatsApp de los doctores así lo evalúan ellos:" +
    MESSAGE_BREAK +
    "Hola Doc! Nos armaron esta prueba gratis cargada con los datos del consultorio: {link} . Es una asistente de IA para el WhatsApp que responde dudas de pacientes y obras sociales 24/7 sin menús robóticos, agenda turnos y rellena sola los huecos de cancelaciones. Probala haciéndole una pregunta como paciente.",
  whatsapp_feedback: "Gracias por contestarme. No te escribo más. Si me decís en una línea por qué no te sirve, me ayudás un montón.",
  instagram:
    "Hola {saludo}! Soy Axel, de Turnia. Armé una demo de Sofi con tu consultorio: contesta el WhatsApp cuando estás atendiendo o fuera de horario y da los turnos sola. ¿Te paso el link para probarla? Es un minuto.",
  llamada:
    "Hola, ¿qué tal? ¿Es el consultorio de {destinatario}? Soy Axel, de Turnia. Le preparé una demo de una asistente que contesta el WhatsApp del consultorio y da turnos cuando nadie puede atender. ¿Me pasás un WhatsApp para mandársela? Si es el de {saludo}, mejor: así la prueba directo.",
};

export const TEMPLATE_VARIABLES = [
  ["{del_consultorio}", "«del Consultorio Odontológico Pérez» o «del consultorio de la Dra. Pérez»"],
  ["{destinatario}", "«la Dra. Pérez» o el nombre completo"],
  ["{consultorio}", "nombre del consultorio en la demo"],
  ["{link}", "su demo"],
  ["{saludo}", "nombre de pila"],
  ["{nombre}", "nombre completo"],
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

/** Un nombre que ya es el de un consultorio («Consultorios Dentales», «Dental Studio»), no el de una persona. */
const BUSINESS_WORDS = /\b(consultorios?|cl[ií]nicas?|centro|odontolog[ií]a|dental|dentales|estudio|instituto|sonrisas?)\b/i;

/**
 * Cómo se nombra el consultorio en «la recepción …»: «del Consultorio Odontológico Moreta», «de AB
 * Consultorios» o, sin el nombre del consultorio, «del consultorio de la Dra. Moreta». Del nombre del
 * consultorio queda lo que va antes de « | » o « - » (en Google Maps suelen sumar la especialidad).
 */
export function ofPractice(person: Pick<OutreachPerson, "name" | "title" | "business_name">): string {
  const business = (person.business_name || "").split(/\s+[|–-]\s+/)[0].trim();
  if (business) return ofBusiness(business);
  if (!person.title && BUSINESS_WORDS.test(person.name)) return ofBusiness(person.name);
  return `del consultorio de ${recipientLabel(person)}`;
}

export function renderTemplate(template: string, person: OutreachPerson, link: string): string {
  const values: Record<string, string> = {
    saludo: person.greeting || person.name.split(/\s+/)[0] || "",
    nombre: person.name,
    destinatario: recipientLabel(person),
    consultorio: person.business_name || `el consultorio de ${person.name}`,
    del_consultorio: ofPractice(person),
    link,
    zona: person.zone,
  };
  return template
    .replace(/\{(saludo|nombre|destinatario|consultorio|del_consultorio|link|zona)\}/g, (_, key: string) => values[key])
    // «a el Dr. Arias» → «al Dr. Arias»; «de el Dr.» → «del Dr.».
    .replace(/\b([Aa]|[Dd]e) el Dr\./g, "$1l Dr.");
}

/** Lo que se sabe para elegir el próximo mensaje de WhatsApp. */
export type SequenceFacts = Pick<OutreachPerson, "touches" | "greeted_at" | "permission_at" | "last_reply_at">;

/** Respondió después del Paso 2 (lo que decide entre el Paso 3 y el Seguimiento 1). */
export const repliedToPermission = (p: SequenceFacts) =>
  Boolean(p.permission_at && p.last_reply_at && Date.parse(p.last_reply_at) > Date.parse(p.permission_at));

/** El Seguimiento 1 espera 24 horas desde el Paso 2. */
export const PERMISSION_WAIT_HOURS = 24;

/**
 * Qué mensaje de WhatsApp toca, siempre a la recepción: el Paso 1 (sin link), el 2 (pide permiso,
 * sin link), el 3 si respondió el 2 o el Seguimiento 1 si no, y los Seguimientos 2 y 3. `null`
 * cuando ya se le escribió tres veces.
 */
export function whatsappTemplateKey(person: SequenceFacts): TemplateKey | null {
  if (person.touches >= MAX_TOUCHES) return null;
  if (person.touches === 0 && !person.greeted_at) return "whatsapp_abridor";
  if (person.touches === 0 && !person.permission_at) return "whatsapp_permiso";
  if (person.touches === 0) return repliedToPermission(person) ? "whatsapp_entrega" : "whatsapp_sin_respuesta";
  return person.touches === 1 ? "whatsapp_seguimiento" : "whatsapp_reenviable";
}

/** Los mensajes que no cuentan como uno de los tres (el Paso 1 y el Paso 2), con el detalle que dejan en la historia. */
export const NON_TOUCH_DETAIL = { whatsapp_abridor: "saludo", whatsapp_permiso: "permiso", whatsapp_permiso_turno: "permiso" } as const;

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

/**
 * Cuándo toca el próximo mensaje después del toque número `touches` (1, 2 o 3): el Seguimiento 2 al
 * día hábil siguiente del link y el 3 dos días hábiles después (48-72 h).
 */
export function nextFollowUp(today: string, touches: number): string | null {
  if (touches >= MAX_TOUCHES) return null;
  return addBusinessDays(today, touches === 1 ? 1 : 2);
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
