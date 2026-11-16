import { describe, expect, it } from "vitest";
import { busyFromFree, fitsFree, freeRanges, smileEmail, smileIdNumber, smilePhone, splitName } from "./smile-connect-api";

// Conversiones puras de la API de Smile Connect: celdas libres → tramos, lo ocupado, nombres y teléfonos.

const t = (hhmm: string) => Date.parse(`2026-12-02T${hhmm}:00Z`);
const cell = (pro: number, a: string, b: string) => ({ start: `2026-12-02T${a}:00.000Z`, end: `2026-12-02T${b}:00.000Z`, professionalId: pro });

describe("disponibilidad de Smile Connect", () => {
  it("une las celdas de 5 minutos en tramos por profesional", () => {
    const free = freeRanges([cell(334, "14:00", "14:05"), cell(334, "14:05", "14:10"), cell(335, "15:00", "15:05"), cell(334, "14:30", "14:35")]);
    expect(free.get(334)).toEqual([[t("14:00"), t("14:10")], [t("14:30"), t("14:35")]]);
    expect(free.get(335)).toEqual([[t("15:00"), t("15:05")]]);
  });

  it("lo ocupado es todo lo que no está libre en el día", () => {
    const free: Array<[number, number]> = [[t("14:00"), t("15:00")], [t("16:00"), t("17:00")]];
    expect(busyFromFree(free, t("12:00"), t("18:00"))).toEqual([[t("12:00"), t("14:00")], [t("15:00"), t("16:00")], [t("17:00"), t("18:00")]]);
    expect(busyFromFree([], t("12:00"), t("18:00"))).toEqual([[t("12:00"), t("18:00")]]);
    expect(fitsFree(free, t("14:15"), t("14:45"))).toBe(true);
    expect(fitsFree(free, t("14:45"), t("15:15"))).toBe(false);
  });
});

describe("datos para crear un paciente en Smile Connect", () => {
  it("separa nombre y apellido (los dos obligatorios)", () => {
    expect(splitName("María José García")).toEqual({ name: "María José", surname: "García" });
    expect(splitName("Juana")).toEqual({ name: "Juana", surname: "Sin apellido" });
    expect(splitName("  ")).toEqual({ name: "Paciente", surname: "Sin apellido" });
  });

  it("pasa el celular de WhatsApp al número nacional sin el 9", () => {
    expect(smilePhone("5492235551234")).toEqual({ phone_country_code: "54", phone_number: "2235551234" });
    expect(smilePhone("541155550000")).toEqual({ phone_country_code: "54", phone_number: "1155550000" });
    expect(smilePhone("12025550100")).toBeNull();
    expect(smilePhone(null)).toBeNull();
  });
});

describe("datos del paciente que acepta Smile Connect", () => {
  it("deja afuera el mail o el documento que la API rechazaría", () => {
    expect(smileEmail("ana.perez@mail.com")).toBe("ana.perez@mail.com");
    expect(smileEmail(" ana@mail.com.ar ")).toBe("ana@mail.com.ar");
    for (const bad of ["ana@mail", "ana..perez@mail.com", ".ana@mail.com", "ana perez@mail.com", "ana@mail.c", "", null]) expect(smileEmail(bad)).toBeUndefined();
    expect(smileIdNumber("30111222")).toBe("30111222");
    expect(smileIdNumber("x".repeat(51))).toBeUndefined();
    expect(smileIdNumber(null)).toBeUndefined();
  });
});
