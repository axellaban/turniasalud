import { z } from "zod";

// Reglas de una audiencia propia (Turnia Activa · Nueva audiencia). Se leen como una frase:
// «Pacientes que no vienen hace más de 9 meses, se atendieron de ortodoncia, con cualquier profesional».
// Solo usan datos que Turnia ya tiene: la agenda (incluido lo que trae Smile Connect), las visitas
// importadas y la ficha del paciente. Se comparten entre el navegador y el servidor.

export const MONTH_OPTIONS = [3, 6, 9, 12, 18, 24] as const;

export const audienceRulesSchema = z
  .object({
    /** No vienen hace más de N meses (última visita en Turnia, Smile Connect o el sistema anterior). */
    monthsSince: z.number().int().min(1).max(120).nullable().default(null),
    /** Se atendieron de esta prestación. */
    appointmentTypeId: z.uuid().nullable().default(null),
    /** Con este profesional (null = cualquiera). */
    professionalId: z.uuid().nullable().default(null),
    /** Cobertura (obra social o prepaga), como figura en la ficha. */
    coverage: z.string().trim().min(1).max(120).nullable().default(null),
    ageMin: z.number().int().min(0).max(120).nullable().default(null),
    ageMax: z.number().int().min(0).max(120).nullable().default(null),
    /** Cumplen años este mes. */
    birthdayThisMonth: z.boolean().default(false),
    /** Faltaron a un turno en los últimos 12 meses. */
    noShow: z.boolean().default(false),
    /** Tienen un control indicado por el profesional que ya llegó y no vinieron. */
    controlIndicated: z.boolean().default(false),
  })
  .refine((r) => r.ageMin === null || r.ageMax === null || r.ageMin <= r.ageMax, { message: "La edad mínima no puede ser mayor que la máxima." });

export type AudienceRules = z.infer<typeof audienceRulesSchema>;

export const EMPTY_RULES: AudienceRules = {
  monthsSince: 9,
  appointmentTypeId: null,
  professionalId: null,
  coverage: null,
  ageMin: null,
  ageMax: null,
  birthdayThisMonth: false,
  noShow: false,
  controlIndicated: false,
};

/** Al menos una regla: una audiencia sin reglas sería toda la base (para eso está «Aviso a todos»). */
export function hasAnyRule(r: AudienceRules): boolean {
  return Boolean(r.monthsSince || r.appointmentTypeId || r.professionalId || r.coverage || r.ageMin !== null || r.ageMax !== null || r.birthdayThisMonth || r.noShow || r.controlIndicated);
}

export function parseRules(value: unknown): AudienceRules | null {
  const parsed = audienceRulesSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** La frase que describe la audiencia, con los nombres de la clínica. */
export function describeRules(r: AudienceRules, names: { type?: string | null; professional?: string | null } = {}): string {
  const parts: string[] = [];
  if (r.monthsSince) parts.push(`no vienen hace más de ${r.monthsSince} meses`);
  if (r.appointmentTypeId) parts.push(`se atendieron de ${(names.type ?? "esa prestación").toLowerCase()}`);
  // «con cualquier profesional» completa la frase de la prestación; solo, no dice nada.
  if (r.professionalId) parts.push(`con ${names.professional ?? "ese profesional"}`);
  else if (r.appointmentTypeId) parts[parts.length - 1] += ", con cualquier profesional";
  if (r.coverage) parts.push(`tienen ${r.coverage}`);
  if (r.ageMin !== null && r.ageMax !== null) parts.push(`tienen entre ${r.ageMin} y ${r.ageMax} años`);
  else if (r.ageMin !== null) parts.push(`tienen ${r.ageMin} años o más`);
  else if (r.ageMax !== null) parts.push(`tienen ${r.ageMax} años o menos`);
  if (r.birthdayThisMonth) parts.push("cumplen años este mes");
  if (r.noShow) parts.push("faltaron a un turno en el último año");
  if (r.controlIndicated) parts.push("tienen un control indicado que ya llegó");
  return `Pacientes que ${parts.join(", ")}.`;
}
