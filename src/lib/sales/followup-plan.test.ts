import { describe, expect, it } from "vitest";
import { byPriority, currentSituation, derivedSituation, groupOf, outsideHours, planFor, isSituation, type PlanInput } from "./followup-plan";

// Las reglas de la cola de Follow-up (traídas de habita.): qué toca, qué la bloquea y en qué orden.
const TUE_11 = new Date("2026-11-10T14:00:00Z");
const base: PlanInput = { stage: "sin-saludo", situation: "sin_respuesta", touches: 0, whatsapp: true, contactable: true, nextActionOn: null, lastContactAt: null, snoozedUntil: null, hasVersion: true, sentThisVersion: false, newToday: 0, dailyCap: 50 };

describe("cola de Follow-up", () => {
  it("la situación sale del estado de Prospección; la marcada a mano vale en el mismo paso", () => {
    expect(derivedSituation({ status: "baja", touches: 0, suppressed: false, whatsapp: true })).toBe("no_contactar");
    expect(derivedSituation({ status: "respondio", touches: 0, suppressed: false, whatsapp: true })).toBe("confirmo_numero");
    expect(derivedSituation({ status: "contactado", touches: 1, suppressed: false, whatsapp: false })).toBe("sin_whatsapp");
    expect(currentSituation("sin_respuesta", { situation: "interesado", step: 1 }, 1)).toEqual({ situation: "interesado", manual: true });
    expect(currentSituation("sin_respuesta", { situation: "interesado", step: 1 }, 2)).toEqual({ situation: "sin_respuesta", manual: false });
    expect(currentSituation("rechazo", { situation: "interesado", step: 1 }, 1).situation).toBe("rechazo");
  });

  it("bloqueos: horario, tope diario, duplicado, sin WhatsApp, reprogramada; cerrados y tres mensajes no tienen acción", () => {
    expect(planFor(base, "nuevos", TUE_11)).toMatchObject({ pending: true, blocked: null });
    expect(planFor(base, "nuevos", new Date("2026-11-11T01:00:00Z")).blocked).toContain("Fuera de horario");
    expect(planFor({ ...base, newToday: 50 }, "nuevos", TUE_11).blocked).toContain("Tope de 50");
    expect(planFor({ ...base, contactable: false }, "nuevos", TUE_11).blocked).toContain("duplicado");
    expect(planFor({ ...base, whatsapp: false }, "nuevos", TUE_11).blocked).toContain("Sin WhatsApp");
    expect(planFor({ ...base, snoozedUntil: "2026-11-12T12:00:00Z" }, "nuevos", TUE_11).blocked).toContain("Reprogramada");
    expect(planFor({ ...base, situation: "rechazo" }, "nuevos", TUE_11).pending).toBe(false);
    expect(planFor({ ...base, stage: "demo-sin-abrir", touches: 3 }, "seguimientos", TUE_11).pending).toBe(false);
  });

  it("programadas: la cadencia de Prospección en los primeros pasos y 48 h después", () => {
    expect(planFor({ ...base, stage: "demo-sin-abrir", touches: 1, nextActionOn: "2026-11-12" }, "seguimientos", TUE_11).dueAt).toBe("2026-11-12T12:00:00.000Z");
    expect(planFor({ ...base, stage: "abrio-sin-conversar", touches: 1, lastContactAt: "2026-11-09T14:00:00Z" }, "seguimientos", TUE_11).dueAt).toBe("2026-11-11T14:00:00.000Z");
    expect(planFor({ ...base, stage: "abrio-sin-conversar", touches: 1, lastContactAt: "2026-11-07T14:00:00Z" }, "seguimientos", TUE_11).dueAt).toBeNull();
    // Una respuesta se atiende ya, sin esperar la cadencia.
    expect(planFor({ ...base, stage: "demo-sin-abrir", touches: 1, nextActionOn: "2026-11-12", situation: "pregunta_precios" }, "respuestas", TUE_11).dueAt).toBeNull();
  });

  it("orden: prioridad, grupo, prioridad de la lista, los que pagan anuncios y los que esperan hace más", () => {
    expect(groupOf("saludo-sin-demo", "sin_respuesta")).toBe("demos");
    expect(groupOf("demo-sin-abrir", "pregunta_precios")).toBe("respuestas");
    expect(outsideHours("seguimientos", new Date("2026-11-15T14:00:00Z"))).toContain("domingos");
    const q = [
      { id: "c", priority: "baja", group: "nuevos", rank: 1, since: "2026-11-01", ads: false },
      { id: "b", priority: "baja", group: "nuevos", rank: 1, since: "2026-11-05", ads: true },
      { id: "a", priority: "alta", group: "respuestas", rank: 3, since: "2026-11-09", ads: false },
    ] as const;
    expect([...q].sort(byPriority).map((x) => x.id)).toEqual(["a", "b", "c"]);
  });
});


describe("Recontacto como situación, sin avance de etapa ni envíos automáticos", () => {
  it("pausa la cadencia normal desde Saludado y en etapas posteriores", () => {
    for (const situation of ["recontactar_vacaciones", "recontactar_mas_adelante"] as const) {
      for (const stage of ["saludo-sin-demo", "demo-sin-abrir", "cuenta-sin-actividad"] as const) {
        const result = planFor({ ...base, stage, situation }, "seguimientos", TUE_11);
        expect(result.pending).toBe(false);
        expect(result.actionReason).toContain("Recontacto");
      }
    }
  });
});

describe("recontactar sin adelantar mensajes", () => {
  it("reconoce ambos motivos y conserva el estado manual", () => {
    for (const situation of ["recontactar_vacaciones", "recontactar_mas_adelante"] as const) {
      expect(isSituation(situation)).toBe(true);
      expect(currentSituation("sin_respuesta", { situation, step: 0 }, 0)).toMatchObject({ situation, manual: true });
      expect(planFor({ ...base, stage: "saludo-sin-demo", situation }, "seguimientos", TUE_11))
        .toMatchObject({ pending: false, dueAt: null });
    }
  });
});
