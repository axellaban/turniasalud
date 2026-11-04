// Reglas de turnos que se chequean en código (PLAN_PROTOCOLOS.md): qué hace cada profesional, en qué
// horarios, qué mueve solo recepción y qué acepta cada cobertura. Son funciones puras: las usan las
// herramientas del agente y el panel, y se testean sin base.

import type { AppointmentType, CoverageRule, Professional, ProfessionalType, Schedule } from "./types";

// ---------------------------------------------------------------------------
// Qué prestaciones hace cada profesional
// ---------------------------------------------------------------------------

/**
 * ¿El profesional hace esta prestación? Si tiene prestaciones marcadas en Equipo y horarios, solo
 * esas; si no, todas las de su especialidad (como siempre).
 */
export function professionalDoes(
  pro: Pick<Professional, "id" | "specialty">,
  type: Pick<AppointmentType, "id" | "specialty">,
  links: ProfessionalType[] = [],
): boolean {
  const own = links.filter((l) => l.professional_id === pro.id);
  return own.length ? own.some((l) => l.appointment_type_id === type.id) : pro.specialty === type.specialty;
}

// ---------------------------------------------------------------------------
// Horarios por prestación y horas reservadas para urgencias
// ---------------------------------------------------------------------------

type ScheduleRule = Pick<Schedule, "urgent_only" | "appointment_type_ids">;

/** Los horarios que sirven para todas estas prestaciones (un horario sin prestaciones sirve para todas). */
export function schedulesForTypes<S extends ScheduleRule>(schedules: S[], typeIds: string[]): S[] {
  return schedules.filter((s) => !s.appointment_type_ids?.length || typeIds.every((id) => s.appointment_type_ids!.includes(id)));
}

/**
 * Los horarios en los que Sofi puede dar estas prestaciones. Las horas reservadas para urgencias
 * solo valen para un turno de urgencia; `released` las suma igual (se liberan cerca de la hora).
 */
export function agentSchedules<S extends ScheduleRule>(schedules: S[], typeIds: string[], opts: { urgent: boolean; released?: boolean }): S[] {
  const usable = schedulesForTypes(schedules, typeIds);
  return opts.urgent || opts.released ? usable : usable.filter((s) => !s.urgent_only);
}

// ---------------------------------------------------------------------------
// Turnos que mueve solo recepción
// ---------------------------------------------------------------------------

/**
 * ¿Sofi puede mover un turno de esta prestación que el paciente ya tiene? Lo que da solo el
 * consultorio, solo si la clínica lo permite (Guerra–Mininni, por ejemplo).
 */
export const agentCanMove = (
  type: Pick<AppointmentType, "panel_only" | "agent_can_reschedule">,
  clinic: { move_panel_only: boolean },
) => type.agent_can_reschedule && (!type.panel_only || clinic.move_panel_only);

/** «Extracción», «EXTRACCIÓN » y «extraccion» se comparan igual. */
export const normalizeLabel = (value: string) =>
  value.normalize("NFD").replace(/\p{Diacritic}/gu, "").replace(/\s+/g, " ").trim().toLowerCase();

/** Una consulta o un control de algo (por ejemplo, de implantes) sí los mueve Sofi. */
const CONSULT = /^(?:consulta|control|evaluacion|diagnostico|revision|seguimiento)\b/;

/** «implante, extracción; regeneración» → palabras sin acentos, sin repetir. */
export function parseTerms(text: string | null | undefined): string[] {
  if (!text) return [];
  return [...new Set(text.split(/[,;\n]/).map(normalizeLabel).filter((t) => t.length >= 3))];
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * La palabra por la que este turno lo mueve recepción, o null. Cuenta también el plural («implantes»,
 * «extracciones»). Lo que empieza como consulta o control no cuenta.
 */
export function receptionOnlyTerm(label: string | null | undefined, terms: string[]): string | null {
  const normalized = normalizeLabel(label ?? "");
  if (!normalized || CONSULT.test(normalized)) return null;
  return terms.find((t) => new RegExp(`\\b${escapeRegExp(t)}(?:s|es)?\\b`).test(normalized)) ?? null;
}

/** 120 → «dos horas»; 90 → «90 minutos». */
export function durationPhrase(minutes: number): string {
  const words = ["", "una", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez"];
  const hours = minutes / 60;
  if (Number.isInteger(hours) && hours >= 1 && hours < words.length) return hours === 1 ? "una hora" : `${words[hours]} horas`;
  return `${minutes} minutos`;
}

// ---------------------------------------------------------------------------
// Coberturas
// ---------------------------------------------------------------------------

/** «osde», «OSDE » y «Osdé» son la misma cobertura. */
export const coverageKey = (value: string) => normalizeLabel(value);

const planKey = (value: string) => coverageKey(value).replace(/^plan\s+/, "");

export const isParticular = (value: string | null | undefined) => /^particular/.test(coverageKey(value ?? ""));

/** Lo que tiene el paciente: «OSDE» con plan «210», o todo junto como «OSDE 210». */
function sameCoverage(rule: Pick<CoverageRule, "coverage" | "plan">, coverage: string, plan: string | null): boolean {
  const ruleKey = coverageKey(rule.coverage);
  const key = coverageKey(coverage);
  let patientPlan = plan ? planKey(plan) : null;
  if (key !== ruleKey) {
    if (!key.startsWith(`${ruleKey} `)) return false;
    patientPlan ??= planKey(key.slice(ruleKey.length + 1));
  }
  return !rule.plan || (patientPlan !== null && planKey(rule.plan) === patientPlan);
}

const SEVERITY: Record<CoverageRule["mode"], number> = { no_acepta: 3, reintegro: 2, copago: 1, acepta: 0 };

/**
 * La regla que manda para esta cobertura, prestación y profesional: la más específica (prestación,
 * después profesional, después plan). Si empatan, la más restrictiva.
 */
export function bestCoverageRule(
  rules: CoverageRule[],
  target: { coverage: string; plan?: string | null; typeId: string; professionalId: string },
): CoverageRule | null {
  const score = (r: CoverageRule) => (r.appointment_type_id ? 4 : 0) + (r.professional_id ? 2 : 0) + (r.plan ? 1 : 0);
  const matching = rules.filter(
    (r) =>
      sameCoverage(r, target.coverage, target.plan ?? null) &&
      (!r.appointment_type_id || r.appointment_type_id === target.typeId) &&
      (!r.professional_id || r.professional_id === target.professionalId),
  );
  matching.sort((a, b) => score(b) - score(a) || SEVERITY[b.mode] - SEVERITY[a.mode]);
  return matching[0] ?? null;
}

const money = new Intl.NumberFormat("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });

/** «OSDE plan 210» o «OSDE». */
const coverageLabel = (coverage: string, plan: string | null | undefined) => {
  const bare = plan?.trim().replace(/^plan\s+/i, "");
  return `${coverage.trim()}${bare ? ` plan ${bare}` : ""}`;
};

export type CoverageCheck =
  | { ok: true; coverage: string | null; notes: string[] }
  | { ok: false; reason: string };

/**
 * ¿Este profesional atiende estas prestaciones con esta cobertura? Junta la lista de coberturas del
 * profesional (Equipo y horarios) y la matriz de coberturas. Devuelve el nombre de la cobertura como
 * lo cargó la clínica y lo que hay que avisarle al paciente (copago, reintegro, autorización).
 * Particular siempre se puede, salvo que una regla diga lo contrario.
 */
export function checkCoverage(
  pro: Pick<Professional, "id" | "full_name" | "accepted_coverages">,
  types: Array<Pick<AppointmentType, "id" | "name">>,
  coverage: string | null | undefined,
  plan: string | null | undefined,
  rules: CoverageRule[] = [],
): CoverageCheck {
  const wanted = coverage?.trim();
  if (!wanted) return { ok: true, coverage: null, notes: [] };
  const particular = isParticular(wanted);
  const listed = pro.accepted_coverages?.length ? pro.accepted_coverages.find((c) => coverageKey(c) === coverageKey(wanted)) : wanted;
  const label = coverageLabel(wanted, plan);
  const notes: string[] = [];
  // Sin prestación (no debería pasar), igual se mira la lista del profesional.
  for (const type of types.length ? types : [{ id: "", name: "el turno" }]) {
    const rule = bestCoverageRule(rules, { coverage: wanted, plan, typeId: type.id, professionalId: pro.id });
    // Una regla de este profesional manda sobre su lista de coberturas.
    if (!(rule?.professional_id === pro.id) && !particular && !listed) {
      return { ok: false, reason: `${pro.full_name} no atiende por ${wanted}. Atiende: ${pro.accepted_coverages!.join(", ")}.` };
    }
    if (!rule) continue;
    const note = rule.note?.trim() ? ` (${rule.note.trim()})` : "";
    const where = rule.professional_id ? ` con ${pro.full_name}` : "";
    if (rule.mode === "no_acepta") {
      return {
        ok: false,
        reason: particular
          ? `${type.name}${where} no se atiende como particular${note}. Ofrecé otro profesional o consultá con recepción.`
          : `Por ${label} no se atiende ${type.name}${where}${note}. Ofrecé atenderse como particular.`,
      };
    }
    if (rule.mode === "copago") notes.push(`Por ${label}, ${type.name} tiene un copago${rule.copay ? ` de ${money.format(Number(rule.copay))}` : ""}${note}.`);
    if (rule.mode === "reintegro") notes.push(`Por ${label}, ${type.name} es por reintegro: se paga en el consultorio y pide el reintegro con la factura${note}.`);
    if (rule.mode === "acepta" && note) notes.push(`Por ${label}, ${type.name}: ${rule.note!.trim()}.`);
    if (rule.requires_authorization) notes.push(`Para ${type.name} por ${label} necesita la autorización u orden de la prepaga antes del turno: avisale que la traiga.`);
  }
  return { ok: true, coverage: particular ? wanted : (listed ?? wanted), notes: [...new Set(notes)] };
}

/** Texto de una regla para el catálogo del agente. */
export function coverageRuleText(rule: CoverageRule, names: { type?: string; professional?: string }): string {
  const scope = [names.type, names.professional && `con ${names.professional}`].filter(Boolean).join(", ");
  const what = {
    acepta: "se acepta",
    copago: `con copago${rule.copay ? ` de ${money.format(Number(rule.copay))}` : ""}`,
    reintegro: "por reintegro (paga y pide el reintegro con la factura)",
    no_acepta: "no se acepta: ofrecé particular",
  }[rule.mode];
  const extra = [rule.requires_authorization && "necesita autorización u orden de la prepaga", rule.note?.trim()].filter(Boolean).join("; ");
  return `- ${coverageLabel(rule.coverage, rule.plan)}${scope ? ` · ${scope}` : ""}: ${what}${extra ? ` (${extra})` : ""}`;
}
