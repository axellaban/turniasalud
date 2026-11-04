import { describe, expect, it } from "vitest";
import {
  agentCanMove,
  agentSchedules,
  bestCoverageRule,
  checkCoverage,
  coverageRuleText,
  durationPhrase,
  parseTerms,
  professionalDoes,
  receptionOnlyTerm,
  schedulesForTypes,
} from "./booking-rules";
import type { CoverageRule } from "./types";

/** El formato de moneda usa un espacio no separable: se compara como espacio común. */
const plain = (value: unknown) => JSON.parse(JSON.stringify(value).replace(/\u00a0/g, " "));

const rule = (r: Partial<CoverageRule>): CoverageRule => ({
  id: r.id ?? Math.random().toString(36).slice(2),
  clinic_id: "c",
  coverage: "OSDE",
  plan: null,
  appointment_type_id: null,
  professional_id: null,
  mode: "acepta",
  copay: null,
  requires_authorization: false,
  note: null,
  created_at: "2026-11-04T00:00:00Z",
  ...r,
});

describe("qué hace cada profesional", () => {
  const pro = { id: "p1", specialty: "Odontología" };
  const limpieza = { id: "t1", specialty: "Odontología" };
  const conducto = { id: "t2", specialty: "Endodoncia" };
  it("sin prestaciones marcadas, hace las de su especialidad (como siempre)", () => {
    expect(professionalDoes(pro, limpieza)).toBe(true);
    expect(professionalDoes(pro, conducto)).toBe(false);
  });
  it("con prestaciones marcadas, solo esas, aunque sean de otra especialidad", () => {
    const links = [{ professional_id: "p1", appointment_type_id: "t2" }, { professional_id: "otro", appointment_type_id: "t1" }];
    expect(professionalDoes(pro, conducto, links)).toBe(true);
    expect(professionalDoes(pro, limpieza, links)).toBe(false);
  });
});

describe("horarios por prestación y de urgencias", () => {
  const schedules = [
    { id: "comun", urgent_only: false, appointment_type_ids: null },
    { id: "jueves", urgent_only: false, appointment_type_ids: ["conducto"] },
    { id: "guardia", urgent_only: true, appointment_type_ids: null },
  ];
  it("un horario sin prestaciones sirve para todas; uno con prestaciones, solo para esas", () => {
    expect(schedulesForTypes(schedules, ["limpieza"]).map((s) => s.id)).toEqual(["comun", "guardia"]);
    expect(schedulesForTypes(schedules, ["conducto"]).map((s) => s.id)).toEqual(["comun", "jueves", "guardia"]);
    // Dos prácticas en la misma visita: el horario tiene que servir para las dos.
    expect(schedulesForTypes(schedules, ["conducto", "limpieza"]).map((s) => s.id)).toEqual(["comun", "guardia"]);
  });
  it("las horas de urgencias solo para un turno de urgencia, o si se liberan", () => {
    expect(agentSchedules(schedules, ["limpieza"], { urgent: false }).map((s) => s.id)).toEqual(["comun"]);
    expect(agentSchedules(schedules, ["limpieza"], { urgent: true }).map((s) => s.id)).toEqual(["comun", "guardia"]);
    expect(agentSchedules(schedules, ["limpieza"], { urgent: false, released: true }).map((s) => s.id)).toEqual(["comun", "guardia"]);
  });
});

describe("turnos que mueve solo recepción", () => {
  // Las mismas palabras que Guerra–Mininni tenía en el código.
  const terms = parseTerms("implante, implantación, exodoncia, extracción, regeneración");
  it.each([
    ["Implante", "implante"],
    ["Colocación de implantes", "implante"],
    ["Cirugía de regeneración ósea", "regeneracion"],
    ["Extracción dental", "extraccion"],
    ["EXODONCIA de pieza 18", "exodoncia"],
    ["Extracciones múltiples", "extraccion"],
  ])("«%s» lo mueve recepción", (label, term) => {
    expect(receptionOnlyTerm(label, terms)).toBe(term);
  });
  it.each(["Consulta de implantes", "Control de implantes", "Evaluación de extracción", "Mantenimiento periodontal (limpieza)", "", null])(
    "«%s» lo puede mover Sofi",
    (label) => {
      expect(receptionOnlyTerm(label, terms)).toBeNull();
    },
  );
  it("separa por coma, punto y coma o renglón, sin acentos ni repetidos", () => {
    expect(parseTerms("Implante; implante\nExtracción, ab")).toEqual(["implante", "extraccion"]);
    expect(parseTerms(null)).toEqual([]);
  });
  it("lo que da solo el consultorio, solo si la clínica lo permite", () => {
    expect(agentCanMove({ panel_only: true, agent_can_reschedule: true }, { move_panel_only: false })).toBe(false);
    expect(agentCanMove({ panel_only: true, agent_can_reschedule: true }, { move_panel_only: true })).toBe(true);
    expect(agentCanMove({ panel_only: false, agent_can_reschedule: false }, { move_panel_only: true })).toBe(false);
    expect(agentCanMove({ panel_only: false, agent_can_reschedule: true }, { move_panel_only: false })).toBe(true);
  });
  it("dice la duración en palabras cuando son horas justas", () => {
    expect(durationPhrase(120)).toBe("dos horas");
    expect(durationPhrase(60)).toBe("una hora");
    expect(durationPhrase(90)).toBe("90 minutos");
  });
});

describe("coberturas", () => {
  const pro = { id: "p1", full_name: "Dra. Ruiz", accepted_coverages: null };
  const limited = { id: "p2", full_name: "Dr. Gómez", accepted_coverages: ["OSDE", "Swiss Medical"] };
  const implante = { id: "imp", name: "Implante" };
  const limpieza = { id: "lim", name: "Limpieza" };

  it("sin reglas ni lista, se acepta todo y se guarda como lo escribió el paciente", () => {
    expect(checkCoverage(pro, [limpieza], " Galeno ", null)).toEqual({ ok: true, coverage: "Galeno", notes: [] });
    expect(checkCoverage(pro, [limpieza], "", null)).toEqual({ ok: true, coverage: null, notes: [] });
  });

  it("la lista del profesional sigue valiendo, con el nombre como lo cargó la clínica", () => {
    expect(checkCoverage(limited, [limpieza], "osdé", null)).toEqual({ ok: true, coverage: "OSDE", notes: [] });
    expect(checkCoverage(limited, [limpieza], "Galeno", null)).toEqual({ ok: false, reason: "Dr. Gómez no atiende por Galeno. Atiende: OSDE, Swiss Medical." });
  });

  it("particular siempre se puede, salvo que una regla diga lo contrario", () => {
    expect(checkCoverage(limited, [limpieza], "Particular", null)).toMatchObject({ ok: true, coverage: "Particular" });
    const noParticular = [rule({ coverage: "Particular", professional_id: "p2", mode: "no_acepta" })];
    expect(checkCoverage(limited, [limpieza], "particular", null, noParticular)).toMatchObject({ ok: false, reason: expect.stringContaining("no se atiende como particular") });
  });

  it("manda la regla más específica: prestación, después profesional, después plan", () => {
    const rules = [
      rule({ id: "general", mode: "acepta" }),
      rule({ id: "plan", plan: "210", mode: "copago", copay: "5000" }),
      rule({ id: "implantes", appointment_type_id: "imp", mode: "no_acepta", note: "solo particular" }),
    ];
    expect(bestCoverageRule(rules, { coverage: "OSDE", plan: "210", typeId: "imp", professionalId: "p1" })?.id).toBe("implantes");
    expect(bestCoverageRule(rules, { coverage: "OSDE", plan: "210", typeId: "lim", professionalId: "p1" })?.id).toBe("plan");
    expect(bestCoverageRule(rules, { coverage: "OSDE", plan: "310", typeId: "lim", professionalId: "p1" })?.id).toBe("general");
    expect(bestCoverageRule(rules, { coverage: "Galeno", typeId: "lim", professionalId: "p1" })).toBeNull();
    expect(checkCoverage(pro, [implante], "OSDE", "210", rules)).toEqual({
      ok: false,
      reason: "Por OSDE plan 210 no se atiende Implante (solo particular). Ofrecé atenderse como particular.",
    });
    expect(plain(checkCoverage(pro, [limpieza], "OSDE", "plan 210", rules))).toEqual({ ok: true, coverage: "OSDE", notes: ["Por OSDE plan 210, Limpieza tiene un copago de $ 5.000."] });
  });

  it("entiende el plan escrito junto a la cobertura («OSDE 210»)", () => {
    const rules = [rule({ plan: "210", mode: "reintegro" })];
    expect(checkCoverage(pro, [limpieza], "OSDE 210", null, rules)).toMatchObject({ ok: true, notes: [expect.stringContaining("por reintegro")] });
    expect(checkCoverage(pro, [limpieza], "OSDE 310", null, rules)).toEqual({ ok: true, coverage: "OSDE 310", notes: [] });
  });

  it("una regla del profesional manda sobre su lista, y la autorización se avisa", () => {
    const rules = [rule({ coverage: "Galeno", professional_id: "p2", mode: "acepta", requires_authorization: true })];
    expect(checkCoverage(limited, [limpieza], "Galeno", null, rules)).toEqual({
      ok: true,
      coverage: "Galeno",
      notes: ["Para Limpieza por Galeno necesita la autorización u orden de la prepaga antes del turno: avisale que la traiga."],
    });
  });

  it("en una visita con dos prácticas, alcanza con que una no se acepte", () => {
    const rules = [rule({ appointment_type_id: "imp", mode: "no_acepta" })];
    expect(checkCoverage(pro, [limpieza, implante], "OSDE", null, rules)).toMatchObject({ ok: false });
  });

  it("texto de la regla para Sofi", () => {
    expect(plain(coverageRuleText(rule({ plan: "210", mode: "copago", copay: "5000", requires_authorization: true }), { type: "Limpieza" })))
      .toBe("- OSDE plan 210 · Limpieza: con copago de $ 5.000 (necesita autorización u orden de la prepaga)");
    expect(coverageRuleText(rule({ mode: "no_acepta" }), { professional: "Dra. Ruiz" })).toBe("- OSDE · con Dra. Ruiz: no se acepta: ofrecé particular");
  });
});
