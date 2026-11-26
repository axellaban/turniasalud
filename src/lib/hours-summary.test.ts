import { describe, expect, it } from "vitest";
import { daysInText, hoursTextMismatch, scheduleSummary, timesInText } from "./hours-summary";

const r = (weekday: number, start: string, end: string, extra: Record<string, unknown> = {}) => ({ weekday, start_time: `${start}:00`, end_time: `${end}:00`, ...extra });

// Como Guerra–Mininni: Coldeira de lunes a miércoles desde las 9, Mininni de lunes a viernes.
const agenda = [
  r(1, "09:00", "17:30"), r(2, "09:00", "18:30"), r(3, "09:00", "17:30"),
  r(1, "10:00", "17:30"), r(2, "10:00", "18:30"), r(3, "10:00", "17:30"), r(4, "10:00", "18:30"), r(5, "11:00", "17:30"),
  r(4, "08:00", "09:00", { urgent_only: true }),
];

describe("scheduleSummary", () => {
  it("arma el horario con los tramos comunes, uniendo profesionales y días seguidos iguales", () => {
    expect(scheduleSummary(agenda)).toBe("Lunes y miércoles de 9 a 17:30, martes de 9 a 18:30, jueves de 10 a 18:30 y viernes de 11 a 17:30");
    expect(scheduleSummary([1, 2, 3, 4, 5].map((d) => r(d, "09:00", "13:00")).concat([1, 2, 3, 4, 5].map((d) => r(d, "15:00", "19:00")))))
      .toBe("Lunes a viernes de 9 a 13 y de 15 a 19");
    expect(scheduleSummary([r(2, "09:00", "12:00"), r(4, "09:00", "12:00")])).toBe("Martes y jueves de 9 a 12");
    expect(scheduleSummary([1, 2, 3, 5].map((d) => r(d, "08:00", "17:00")).concat([r(6, "09:00", "13:00")]))).toBe("Lunes a miércoles y viernes de 8 a 17 y sábado de 9 a 13");
    expect(scheduleSummary([r(1, "09:00", "12:00", { appointment_type_ids: ["x"] })])).toBeNull();
  });
});

describe("hoursTextMismatch", () => {
  it("marca el texto que quedó viejo (el caso de la auditoría: dice 10 y la agenda arranca a las 9)", () => {
    expect(hoursTextMismatch("Lunes de 10 a 17:30, martes de 10 a 18:30, miércoles de 10 a 17:30, jueves de 10 a 18:30 y viernes de 11 a 17:30", agenda)).toBe(true);
    expect(hoursTextMismatch(scheduleSummary(agenda), agenda)).toBe(false);
  });

  it("no marca una simplificación razonable ni un texto sin horas", () => {
    const split = [1, 2, 3, 4, 5].flatMap((d) => [r(d, "09:00", "13:00"), r(d, "14:00", "18:00")]);
    expect(hoursTextMismatch("Lunes a viernes de 9 a 18 hs", split)).toBe(false);
    expect(hoursTextMismatch("Con turno previo", split)).toBe(false);
    expect(hoursTextMismatch("", split)).toBe(false);
    expect(hoursTextMismatch("Lunes a viernes de 9 a 18", [])).toBe(false);
  });

  it("marca días que no coinciden", () => {
    const week = [1, 2, 3, 4].map((d) => r(d, "09:00", "18:00"));
    expect(hoursTextMismatch("Lunes a viernes de 9 a 18", week)).toBe(true);
    expect(hoursTextMismatch("Lunes a jueves de 9 a 18", week)).toBe(false);
  });
});

describe("lectura del texto", () => {
  it("entiende rangos de días y horas con o sin minutos", () => {
    expect([...daysInText("Lunes a miércoles y viernes")!].sort()).toEqual([1, 2, 3, 5]);
    expect(daysInText("Con turno")).toBeNull();
    expect([...timesInText("de 9 a 17:30 hs")].sort((a, b) => a - b)).toEqual([540, 1050]);
    expect([...timesInText("Tolerancia de 15 minutos, desde 2026")]).toEqual([900]);
  });
});
