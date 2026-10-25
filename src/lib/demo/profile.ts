import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { dentalServices, servicesPhrase } from "./dental-services";
import type { ScrapeResult } from "./scraper";
import type { ManualClinic } from "./website";

// Convierte el texto de la web en los datos de una clínica (nombre, sede,
// profesionales, prácticas, horarios, coberturas, preguntas frecuentes) para
// armar la clínica de la demo. Con ANTHROPIC_API_KEY lo hace Claude; sin
// clave, o si falla, se arma un perfil básico con lo que se ve a simple vista.

export const Profile = z.object({
  nombre: z.string().describe("Nombre del consultorio, clínica o profesional, como aparece en la web"),
  especialidad: z.string().describe('Especialidad principal, ej. "Odontología", o "Multiespecialidad"'),
  descripcion: z.string().describe("Qué hacen, en 1 o 2 oraciones"),
  direccion: z.string().nullable(),
  telefono: z.string().nullable(),
  horario_texto: z.string().nullable().describe('Horario de atención como texto, ej. "Lunes a viernes de 9 a 19 h"'),
  horarios: z
    .array(z.object({ dia: z.number().int().describe("0=domingo … 6=sábado"), desde: z.string().describe("HH:MM"), hasta: z.string().describe("HH:MM") }))
    .describe("Horario de atención por día. Vacío si la web no lo dice"),
  coberturas: z.array(z.string()).describe("Obras sociales y prepagas que aceptan; incluir Particular si atienden particular"),
  profesionales: z
    .array(
      z.object({
        nombre: z.string().describe('Con título, ej. "Dra. Ana Pérez"'),
        especialidad: z.string().describe("Usar exactamente el mismo texto que en prestaciones.especialidad"),
        dias: z.array(z.number().int()).describe("Días que atiende (0=domingo … 6=sábado). Vacío si no se sabe"),
        bio: z.string().nullable(),
      }),
    )
    .describe("Solo profesionales que figuran en la web. Vacío si no figura ninguno"),
  prestaciones: z
    .array(
      z.object({
        nombre: z.string().describe('Tipo de turno, ej. "Consulta de primera vez", "Limpieza dental"'),
        especialidad: z.string(),
        duracion_min: z.number().int().describe("Duración estimada del turno en minutos"),
        precio: z.number().nullable().describe("Precio en pesos si figura; si no, null"),
        indicaciones: z.string().nullable().describe("Preparación previa si la web la indica"),
        primera_vez: z.boolean(),
      }),
    )
    .describe("Tipos de turno que se pueden reservar (entre 2 y 12)"),
  preguntas_frecuentes: z.string().describe("Todo lo útil para responder a pacientes: servicios, estudios, formas de pago, estacionamiento, cómo llegar, etc. Viñetas cortas"),
  politicas: z.string().nullable().describe("Cancelaciones, tolerancia, requisitos, si la web los menciona"),
});

export type DemoProfile = z.infer<typeof Profile>;

const SYSTEM = `Leés el texto de la web de un consultorio, centro médico u odontológico de Argentina y armás su ficha para que una recepcionista virtual atienda a sus pacientes y dé turnos.
Reglas:
- Usá solo datos que aparecen en la web. No inventes profesionales, direcciones, teléfonos, precios ni coberturas.
- Si la web no lista tipos de turno, deducí prestaciones razonables de los servicios que ofrece (consulta de primera vez, control, la práctica principal), con duraciones habituales.
- Las especialidades de profesionales y prestaciones tienen que coincidir textualmente para que se puedan cruzar.
- Escribí en español rioplatense, claro y breve.`;

/** Datos de la clínica a partir del texto de su web. */
export async function buildProfile(site: ScrapeResult): Promise<DemoProfile> {
  if (!process.env.ANTHROPIC_API_KEY) return fallbackProfile(site);
  try {
    const client = new Anthropic({ timeout: 90_000, maxRetries: 1 });
    const response = await client.beta.messages.parse({
      model: process.env.DEMO_LLM || "claude-opus-5-5",
      max_tokens: 16000,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      // Es una extracción: poco razonamiento alcanza y la persona está esperando en WhatsApp.
      output_config: { effort: "low", format: betaZodOutputFormat(Profile) },
      system: SYSTEM,
      messages: [{ role: "user", content: `Web: ${site.url}\n\n${site.text}` }],
    });
    if (response.stop_reason === "refusal" || !response.parsed_output) {
      console.error("Demo: Claude no devolvió el perfil", response.stop_reason);
      return fallbackProfile(site);
    }
    return sanitizeProfile(response.parsed_output, site);
  } catch (e) {
    if (e instanceof Anthropic.APIError) console.error(`Demo: error de la API de Claude ${e.status}`, e.message);
    else console.error("Demo: no se pudo armar el perfil con Claude", e instanceof Error ? e.message : e);
    return fallbackProfile(site);
  }
}

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const clean = (s: string | null | undefined, max = 400) => (s ?? "").replace(/\s+/g, " ").trim().slice(0, max) || null;

/** Recorta y corrige lo que vuelve del modelo para que entre en la base sin sorpresas. Puro. */
export function sanitizeProfile(p: DemoProfile, site: Pick<ScrapeResult, "url">): DemoProfile {
  const horarios = p.horarios
    .filter((h) => Number.isInteger(h.dia) && h.dia >= 0 && h.dia <= 6 && HHMM.test(h.desde) && HHMM.test(h.hasta))
    .map((h) => ({ dia: h.dia, desde: h.desde.padStart(5, "0"), hasta: h.hasta.padStart(5, "0") }))
    .filter((h) => h.hasta > h.desde)
    .slice(0, 14);
  return {
    nombre: clean(p.nombre, 120) ?? new URL(site.url).hostname.replace(/^www\./, ""),
    especialidad: clean(p.especialidad, 80) ?? "Consultorio",
    descripcion: clean(p.descripcion, 500) ?? "",
    direccion: clean(p.direccion, 200),
    telefono: clean(p.telefono, 60),
    horario_texto: clean(p.horario_texto, 300),
    horarios,
    coberturas: [...new Set(p.coberturas.map((c) => clean(c, 60)).filter((c): c is string => Boolean(c)))].slice(0, 40),
    profesionales: p.profesionales
      .map((pr) => ({
        nombre: clean(pr.nombre, 100) ?? "",
        especialidad: clean(pr.especialidad, 80) ?? clean(p.especialidad, 80) ?? "Consulta",
        dias: [...new Set(pr.dias.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))],
        bio: clean(pr.bio, 200),
      }))
      .filter((pr) => pr.nombre)
      .slice(0, 12),
    prestaciones: p.prestaciones
      .map((t) => ({
        nombre: clean(t.nombre, 100) ?? "",
        especialidad: clean(t.especialidad, 80) ?? clean(p.especialidad, 80) ?? "Consulta",
        duracion_min: Math.min(240, Math.max(10, Math.round((t.duracion_min || 30) / 5) * 5)),
        precio: typeof t.precio === "number" && t.precio > 0 && t.precio < 100_000_000 ? Math.round(t.precio) : null,
        indicaciones: clean(t.indicaciones, 300),
        primera_vez: Boolean(t.primera_vez),
      }))
      .filter((t) => t.nombre)
      .slice(0, 12),
    preguntas_frecuentes: (p.preguntas_frecuentes ?? "").trim().slice(0, 4000),
    politicas: p.politicas?.trim().slice(0, 1500) || null,
  };
}

const SPECIALTIES: Array<[RegExp, string]> = [
  [/odontolog|dental|dentist|ortodonc|implante/i, "Odontología"],
  [/dermatolog/i, "Dermatología"],
  [/pediatr/i, "Pediatría"],
  [/kinesiolog|fisioterap|rehabilitaci/i, "Kinesiología"],
  [/oftalmolog/i, "Oftalmología"],
  [/psicolog|psiquiatr|terapia/i, "Psicología"],
  [/nutrici/i, "Nutrición"],
  [/ginecolog|obstetric/i, "Ginecología"],
  [/traumatolog/i, "Traumatología"],
  [/cardiolog/i, "Cardiología"],
  [/est[ée]tic/i, "Medicina estética"],
  [/veterinari/i, "Veterinaria"],
];

/** Perfil mínimo sin modelo: nombre, teléfono, especialidad probable y el texto de la web como preguntas frecuentes. Puro. */
export function fallbackProfile(site: ScrapeResult): DemoProfile {
  const host = new URL(site.url).hostname.replace(/^www\./, "");
  const siteName = /Nombre del sitio: (.+)/.exec(site.text)?.[1]?.trim();
  const titlePart = site.pages[0]?.title.split(/\s[|\-–—·]\s/)[0]?.trim();
  // "Home", "Inicio" o "Bienvenidos" no son nombres.
  const title = siteName || (titlePart && !/^(home|inicio|index|bienvenid[oa]s?|p[aá]gina principal)$/i.test(titlePart) ? titlePart : null);
  const phone = /Teléfono: ([+\d][\d\s().-]{6,})/.exec(site.text)?.[1]?.trim() ?? null;
  const address = /"streetAddress"\s*:\s*"([^"]+)"/.exec(site.text)?.[1] ?? null;
  const counts = SPECIALTIES.map(([re, name]) => [name, (site.text.match(new RegExp(re.source, "gi")) ?? []).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const specialty = counts[0]?.[0] ?? "Consulta médica";
  return {
    nombre: title || host,
    especialidad: specialty,
    descripcion: "",
    direccion: address,
    telefono: phone,
    horario_texto: null,
    horarios: [],
    coberturas: [],
    profesionales: [],
    prestaciones: [
      { nombre: "Consulta de primera vez", especialidad: specialty, duracion_min: 30, precio: null, indicaciones: null, primera_vez: true },
      { nombre: "Control", especialidad: specialty, duracion_min: 20, precio: null, indicaciones: null, primera_vez: false },
    ],
    preguntas_frecuentes: `Información de la web (${host}):\n${site.text.slice(0, 3500)}`,
    politicas: null,
  };
}

/** Turnos habituales de un consultorio odontológico, para la demo sin web. */
const DENTAL_TYPES: DemoProfile["prestaciones"] = [
  { nombre: "Consulta de primera vez", especialidad: "Odontología", duracion_min: 30, precio: null, indicaciones: null, primera_vez: true },
  { nombre: "Limpieza dental", especialidad: "Odontología", duracion_min: 40, precio: null, indicaciones: null, primera_vez: false },
  { nombre: "Control", especialidad: "Odontología", duracion_min: 20, precio: null, indicaciones: null, primera_vez: false },
  { nombre: "Urgencia odontológica", especialidad: "Odontología", duracion_min: 30, precio: null, indicaciones: null, primera_vez: false },
];

/** Ficha de la demo sin web: solo nombre, dirección y especialidad; el resto es de ejemplo y el agente no lo inventa. Pura. */
export function manualProfile(input: ManualClinic): DemoProfile {
  const said = input.especialidad ?? input.nombre;
  const specialty = SPECIALTIES.find(([re]) => re.test(said))?.[1] ?? clean(input.especialidad, 80) ?? "Consulta médica";
  // Los tratamientos que declara el odontólogo suman su turno de primera vez (implantes, ortodoncia…).
  const services = specialty === "Odontología" ? dentalServices(input.servicios) : [];
  const prestaciones = specialty === "Odontología"
    ? [
        ...DENTAL_TYPES,
        ...services.map((s) => ({ nombre: s.turno, especialidad: "Odontología", duracion_min: s.duracion_min, precio: null, indicaciones: null, primera_vez: true })),
      ]
    : [
        { nombre: "Consulta de primera vez", especialidad: specialty, duracion_min: 30, precio: null, indicaciones: null, primera_vez: true },
        { nombre: "Control", especialidad: specialty, duracion_min: 20, precio: null, indicaciones: null, primera_vez: false },
      ];
  return {
    nombre: clean(input.nombre, 120) ?? "Tu consultorio",
    especialidad: specialty,
    descripcion: "",
    direccion: clean(input.direccion, 200),
    telefono: null,
    horario_texto: "Lunes a viernes de 9 a 18 h (horario de ejemplo de la demo)",
    horarios: [],
    coberturas: [],
    profesionales: input.profesional
      ? [{ nombre: input.profesional, especialidad: specialty, dias: [], bio: services.length ? `Odontología general, ${servicesPhrase(services)}` : null }]
      : [],
    prestaciones,
    preguntas_frecuentes: [
      input.profesional
        ? `- Demo armada sin web: del consultorio solo se conocen el nombre, la dirección y que atiende ${input.profesional}.`
        : "- Demo armada sin web: del consultorio solo se conocen el nombre y la dirección.",
      services.length && `- Tratamientos que figuran en su perfil profesional: odontología general, ${servicesPhrase(services)}.`,
      input.profesional
        ? "- Precios y obras sociales no figuran: si preguntan, ofrecer que la recepción lo confirme."
        : "- Precios, profesionales y obras sociales no figuran: si preguntan, ofrecer que la recepción lo confirme.",
    ]
      .filter(Boolean)
      .join("\n"),
    politicas: null,
  };
}
