import { describe, expect, it } from "vitest";
import { FOLLOWUP_STAGES, cleanVersion, pct, stageOf, stepOf, versionFor, versionStats, type FollowupExecution, type FollowupVersion } from "./followup-stages";

const none = { greeted: false, touches: 0, opened: false, converso: false, account: false, active: false, client: false };
const open = { closed: false, suppressed: false, landline: false, contactable: true };
const v = (id: string, version: number, status: FollowupVersion["status"]): FollowupVersion => ({
  id, stage: "demo-sin-abrir", version, channel: "whatsapp", trigger_label: "", body: "Hola {saludo}", ctas: ["whatsapp"], status, created_at: "", status_at: "",
});
const ex = (who: string, version: string, status: FollowupExecution["status"], from = 1): FollowupExecution => ({
  id: `${who}${version}`, version_id: version, stage: "demo-sin-abrir", outreach_id: who, from_step: from, status, reason: null, updated_at: "2026-11-07T12:00:00Z",
});

describe("etapas de Follow-up (EMBUDO.md)", () => {
  it("tiene una etapa por paso del embudo que tiene uno siguiente", () => {
    expect(FOLLOWUP_STAGES.map((s) => s.step)).toEqual([-1, 0, 1, 2, 3, 4, 5]);
  });

  it("ubica a cada persona en su paso más alto, sin exigir el anterior", () => {
    expect(stepOf(none)).toBe(-1);
    expect(stepOf({ ...none, greeted: true })).toBe(0);
    expect(stepOf({ ...none, greeted: true, touches: 2 })).toBe(1);
    // Abrió su link aunque el mensaje no quedó registrado: cuenta como abierta.
    expect(stepOf({ ...none, opened: true })).toBe(2);
    expect(stepOf({ ...none, opened: true, converso: true, account: true })).toBe(4);
    expect(stepOf({ ...none, client: true })).toBe(6);
  });

  it("deja afuera a los cerrados, las bajas, los fijos sin respuesta y los clientes", () => {
    expect(stageOf({ ...none, ...open })).toBe("sin-saludo");
    expect(stageOf({ ...none, touches: 1, ...open })).toBe("demo-sin-abrir");
    expect(stageOf({ ...none, account: true, active: true, ...open })).toBe("activa-sin-pago");
    expect(stageOf({ ...none, ...open, closed: true })).toBeNull();
    expect(stageOf({ ...none, ...open, suppressed: true })).toBeNull();
    expect(stageOf({ ...none, ...open, landline: true })).toBeNull();
    expect(stageOf({ ...none, client: true, ...open })).toBeNull();
    // Sin saludar solo entra quien se puede saludar, como en «Para hoy».
    expect(stageOf({ ...none, ...open, contactable: false })).toBeNull();
    expect(stageOf({ ...none, greeted: true, ...open, contactable: false })).toBe("saludo-sin-demo");
  });
});

describe("versiones", () => {
  it("reparte la mitad a la de prueba, siempre igual para cada persona, y sigue con la que empezó", () => {
    const vs = [v("a", 1, "active"), v("b", 2, "test")];
    const ids = Array.from({ length: 200 }, (_, i) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    const test = ids.filter((id) => versionFor(id, vs)!.id === "b").length;
    expect(test).toBeGreaterThan(70);
    expect(test).toBeLessThan(130);
    const other = versionFor(ids[0], vs)!.id === "a" ? "b" : "a";
    expect(versionFor(ids[0], vs, [ex(ids[0], other, "opened")])!.id).toBe(other);
    expect(versionFor("x", [v("a", 1, "active")])!.id).toBe("a");
  });

  it("cuenta ejecuciones enviadas y quienes avanzaron después", () => {
    const vs = [v("a", 1, "active")];
    const [s] = versionStats(vs, [ex("p", "a", "sent", 1), ex("q", "a", "sent", 1), ex("r", "a", "opened", 1), ex("t", "a", "failed", 1)], new Map([["p", 2], ["q", 1], ["r", 5]]));
    expect(s).toMatchObject({ executions: 2, conversions: 1, rate: 0.5, smallSample: true });
    expect(pct(null)).toBe("—");
    expect(pct(0.125)).toBe("13 %");
    expect(pct(0.045)).toBe("4,5 %");
  });

  it("valida el texto, las variables y la etapa", () => {
    expect(cleanVersion({ stage: "sin-saludo", channel: "whatsapp", body: " " })).toEqual({ error: "Escribí la next best action." });
    expect("error" in cleanVersion({ stage: "sin-saludo", channel: "whatsapp", body: "Hola {apodo}" })).toBe(true);
    expect("error" in cleanVersion({ stage: "otra", channel: "whatsapp", body: "Hola" })).toBe(true);
    expect(cleanVersion({ stage: "cuenta-sin-actividad", channel: "whatsapp", body: " Tu panel: {panel} ", ctas: ["panel", "fax"], status: "test", trigger: " lunes " })).toEqual({
      stage: "cuenta-sin-actividad", channel: "whatsapp", trigger: "lunes", body: "Tu panel: {panel}", ctas: ["panel"], status: "test",
    });
  });
});
