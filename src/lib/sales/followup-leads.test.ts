import { describe, expect, it } from "vitest";
import { leadStateOf, leadsView, type LeadInput } from "./followup-leads";

// «Leads» de Chapa para Turnia: el estado de cada consultorio y las reglas que dejaron de salir. Datos sintéticos.
const NOW = new Date("2026-11-19T15:00:00Z");
const base = (o: Partial<LeadInput> = {}): LeadInput => ({
  id: "p1", name: "Consultorio Uno", stage: "demo-sin-abrir", situation: "sin_respuesta", action: "Seguimiento 2", actionReason: null,
  blocked: null, dueAt: null, snoozedUntil: null, claim: null, execution: null, ...o,
});
const stages = [{ key: "demo-sin-abrir", title: "Demo enviada, sin abrir", goal: "Demo visitada" }];
const rules = [{ key: "demo-sin-abrir", stage: "demo-sin-abrir", name: "Seguimiento de la demo", enabled: true }];

describe("Leads de Turnia", () => {
  it("clasifica cada consultorio como en habita.", () => {
    expect(leadStateOf(base(), NOW).state).toBe("lista");
    expect(leadStateOf(base({ dueAt: "2026-11-21T12:00:00Z", blocked: "Programada para el 21/11." }), NOW).state).toBe("programada");
    expect(leadStateOf(base({ blocked: "Sin WhatsApp: cargalo en Prospección." }), NOW).state).toBe("bloqueada");
    expect(leadStateOf(base({ execution: { status: "sent", at: "2026-11-18T12:00:00Z" } }), NOW).state).toBe("hecha");
  });

  it("avisa la regla activa con consultorios que no sale hace más de 3 días y da la última que le salió a cada uno", () => {
    const view = leadsView({
      items: [base(), base({ id: "p2", blocked: "Sin WhatsApp: cargalo en Prospección." })],
      executions: [{ outreach_id: "p1", stage: "demo-sin-abrir", status: "sent", sent_at: "2026-11-12T13:00:00Z" }],
      rules, queueDays: null, stages, now: NOW,
    });
    expect(view.stages[0]).toMatchObject({ count: 2, states: { lista: 1, bloqueada: 1 } });
    expect(view.rows[0]).toMatchObject({ agencyId: "p1", lastRule: { label: "Seguimiento de la demo", at: "2026-11-12T13:00:00.000Z" } });
    expect(view.alerts).toEqual([{ kind: "regla", ruleKey: "demo-sin-abrir", name: "Seguimiento de la demo", stage: "demo-sin-abrir", days: 7, pending: 2, states: { lista: 1, bloqueada: 1 } }]);
  });
});
