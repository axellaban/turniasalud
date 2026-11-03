import { describe, expect, it } from "vitest";
import { followupDue, followupText } from "./followups";

const TZ = "America/Argentina/Buenos_Aires";
const clinic = { followup_attempts: 2, followup_delay_hours: 2, timezone: TZ };
/** 03/11/2026 a las HH:MM de Buenos Aires (UTC−3). */
const at = (hhmm: string, day = 3) => new Date(`2026-11-${String(day).padStart(2, "0")}T${hhmm}:00-03:00`);

describe("seguimiento de turnos ofrecidos", () => {
  it("arma el mensaje con los horarios que siguen libres, sin tutear ni tratar de usted", () => {
    const slots = [{ cuando: "martes 10/11 a las 11:00" }, { cuando: "miércoles 11/11 a las 15:30" }];
    expect(followupText({ name: "MARÍA gonzález", typeName: "Limpieza dental", slots, attempt: 1 })).toBe(
      "Hola María, sobre el turno de limpieza dental: todavía hay lugar el martes 10/11 a las 11:00 o el miércoles 11/11 a las 15:30. ¿Reservamos alguno?",
    );
    expect(followupText({ name: null, typeName: "Consulta", slots: slots.slice(0, 1), attempt: 2 })).toBe(
      "Hola, retomo lo del turno de consulta: todavía hay lugar el martes 10/11 a las 11:00. ¿Lo reservamos?",
    );
    expect(followupText({ name: "Jorge", typeName: "PAMI control", slots: [], attempt: 1 })).toBe(
      "Hola Jorge, sobre el turno de PAMI control: los horarios que vimos ya se ocuparon. ¿Buscamos otros días?",
    );
    expect(followupText({ name: "Jorge", typeName: "Control", slots: [{ cuando: "lunes 9/11 a las 12:00", profesional: "Dra. Ruiz" }], attempt: 1 })).toContain(
      "el lunes 9/11 a las 12:00 con Dra. Ruiz",
    );
  });

  it("espera las horas elegidas, escribe solo de 9 a 20 y el segundo va al día siguiente", () => {
    const offer = { followups_sent: 0, last_followup_at: null, created_at: at("10:00").toISOString() };
    expect(followupDue(offer, clinic, at("11:30"))).toBe("esperar");
    expect(followupDue(offer, clinic, at("12:00"))).toBe("ahora");
    // Ofrecido a las 19:30: a las 21:30 no se escribe; a la mañana siguiente, sí.
    const late = { ...offer, created_at: at("19:30").toISOString() };
    expect(followupDue(late, clinic, at("21:30"))).toBe("esperar");
    expect(followupDue(late, clinic, at("08:59", 4))).toBe("esperar");
    expect(followupDue(late, clinic, at("09:00", 4))).toBe("ahora");

    const once = { followups_sent: 1, last_followup_at: at("12:00").toISOString(), created_at: at("10:00").toISOString() };
    expect(followupDue(once, clinic, at("18:00"))).toBe("esperar");
    expect(followupDue(once, clinic, at("08:00", 4))).toBe("esperar");
    expect(followupDue(once, clinic, at("10:00", 4))).toBe("ahora");
    expect(followupDue(once, { ...clinic, followup_attempts: 1 }, at("10:00", 4))).toBe("terminado");
    expect(followupDue(offer, { ...clinic, followup_attempts: 0 }, at("12:00"))).toBe("terminado");
  });
});
